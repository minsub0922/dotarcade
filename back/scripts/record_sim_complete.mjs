import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Records one real 20-agent run through persisted feedback. The long raw take is
// intentionally left uncut so the story edit can speed up only the waiting parts.
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const rawDir = path.join(root, 'artifacts/video/raw')
const recordName = process.env.DOTCADE_RECORD_NAME || 'studio_story_full_run'
const output = path.join(rawDir, `${recordName}.webm`)
const marksOutput = path.join(rawDir, `${recordName}.marks.json`)
const baseUrl = process.env.DOTCADE_URL || 'http://127.0.0.1:5173/'
const agenda = process.env.DOTCADE_AGENDA || '별빛 정원에서 빛 조각을 모으고 운석을 피하며 파티·도감을 확인하는 2.5D 수집형 캐처'
const meetingTimeoutMs = Number(process.env.DOTCADE_MEETING_TIMEOUT_MS || 20 * 60 * 1000)
const timeoutMs = Number(process.env.DOTCADE_SIM_TIMEOUT_MS || 10 * 60 * 1000)
const size = { width: 1280, height: 720 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const round = value => Math.round(Number(value) * 1000) / 1000

await mkdir(rawDir, { recursive: true })

const browser = await chromium.launch({ headless: process.env.DOTCADE_HEADFUL !== '1' })
const context = await browser.newContext({
  viewport: size,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
  recordVideo: { dir: rawDir, size }
})
await context.addInitScript(() => {
  let state = 0xD07CADE
  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  localStorage.setItem('dotcade-visited-local', '1')
})

const page = await context.newPage()
const video = page.video()
const startedAt = Date.now()
const marks = []
let chosenGame = null

function mark(label, extra = null) {
  const item = { label, seconds: round((Date.now() - startedAt) / 1000) }
  if (extra != null) item.extra = extra
  marks.push(item)
  console.log(`MARK ${label} ${item.seconds.toFixed(3)}${extra == null ? '' : ` ${JSON.stringify(extra)}`}`)
  return item
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => {
    const app = window.__dotcade
    return !!(app?.eng?.player && app?.store?.getState && app?.sim)
  }, null, { timeout: 30_000 })
  await sleep(1200)

  const introClose = page.locator('.modal-back .modal .x').first()
  if (await introClose.isVisible().catch(() => false)) await introClose.click()

  await page.evaluate(() => {
    const state = window.__dotcade.store.getState()
    state.setSettings?.({ autoApprove: true, simConcurrency: 6 })
  })
  mark('ready')

  // One continuous, internally consistent story: this meeting creates the game
  // that is played, deployed, evaluated and later shown in the persisted report.
  await page.getByRole('button', { name: /새 회의 · 게임 만들기/ }).click()
  await page.getByRole('textbox').fill(agenda)
  const referenceToggle = page.locator('#reference-search')
  if (!await referenceToggle.isChecked()) await referenceToggle.check()
  mark('agenda_ready', { agenda, referenceSearch: true })
  await sleep(1100)
  await page.getByRole('button', { name: /레퍼런스 탐색 후 회의 소집/ }).click()
  mark('meeting_started')

  let lastPhase = ''
  let lastReferenceStatus = ''
  let choseDirection = false
  let approved = false
  let terminalMeeting = null
  const meetingDeadline = Date.now() + meetingTimeoutMs
  while (Date.now() < meetingDeadline) {
    const state = await page.evaluate(() => {
      const meeting = window.__dotcade?.store?.getState?.().meeting
      if (!meeting) return null
      const reference = meeting.research?.reference || meeting.referenceResearch || meeting.referenceDiscovery
      return {
        status: meeting.status,
        phase: meeting.phase,
        directionGate: !!meeting.directionGate,
        approval: !!meeting.approval,
        resultGameId: meeting.resultGameId || null,
        resultVersion: meeting.resultVersion || null,
        error: meeting.error || '',
        referenceStatus: reference?.status || '',
        referenceTarget: reference?.selected?.title || reference?.selected?.name || ''
      }
    })
    if (!state) {
      await sleep(250)
      continue
    }
    if (state.phase && state.phase !== lastPhase) {
      lastPhase = state.phase
      mark(`meeting_phase_${state.phase}`)
    }
    if (state.referenceStatus && state.referenceStatus !== lastReferenceStatus) {
      lastReferenceStatus = state.referenceStatus
      if (['searching', 'selecting', 'blueprinting', 'done', 'fallback'].includes(state.referenceStatus)) {
        mark(`reference_${state.referenceStatus}`, { target: state.referenceTarget })
      }
    }
    if (state.directionGate && !choseDirection) {
      const recommended = page.locator('.direction-card.recommended')
      await recommended.waitFor({ state: 'visible', timeout: 15_000 })
      await sleep(1400)
      await recommended.click()
      choseDirection = true
      mark('direction_selected')
    }
    if (state.approval && !approved) {
      const button = page.locator('.approval-go')
      await button.waitFor({ state: 'visible', timeout: 15_000 })
      await sleep(1400)
      await button.click()
      approved = true
      mark('build_started')
    }
    if (['done', 'error', 'cancelled'].includes(state.status)) {
      terminalMeeting = state
      break
    }
    await sleep(350)
  }
  if (!terminalMeeting) throw new Error('meeting did not finish before the recording timeout')
  if (terminalMeeting.status !== 'done' || !terminalMeeting.resultGameId) {
    throw new Error(`meeting ended as ${terminalMeeting.status}: ${terminalMeeting.error}`)
  }

  chosenGame = await page.evaluate(gameId => {
    const state = window.__dotcade.store.getState()
    const selected = state.games.find(game => game.id === gameId)
    return selected ? {
      id: selected.id,
      title: selected.title,
      version: selected.version,
      source: selected.source,
      desc: selected.desc || '',
      genre: selected.genre || '',
      controls: selected.controls || []
    } : null
  }, terminalMeeting.resultGameId)
  if (!chosenGame) throw new Error(`meeting result game ${terminalMeeting.resultGameId} was not loaded`)
  mark('meeting_done', { game: chosenGame })
  await sleep(1800)

  const meetingPlay = page.locator('.panel-foot button.primary').filter({ hasText: '플레이' }).first()
  await meetingPlay.waitFor({ state: 'visible', timeout: 15_000 })
  await meetingPlay.click()
  const gameFrame = page.locator('.play-host iframe')
  await gameFrame.waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('.device-live-state.ready').waitFor({ state: 'visible', timeout: 20_000 })
  mark('game_title', { game: chosenGame.title })
  await gameFrame.click({ position: { x: 240, y: 180 } }).catch(() => {})
  await page.keyboard.press('Enter').catch(() => {})
  await sleep(1600)
  mark('game_first_input')
  const playKeys = ['ArrowRight', 'Space', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'Space', 'ArrowDown', 'ArrowLeft', 'Space']
  for (const key of playKeys) {
    await page.keyboard.press(key).catch(() => {})
    await sleep(620)
  }
  mark('gameplay')
  await sleep(1400)
  const runtimeError = await page.locator('.play-over').filter({ hasText: /ERROR|오류/ }).isVisible().catch(() => false)
  if (runtimeError) throw new Error('newly generated game showed a runtime error during direct play')
  await page.getByRole('button', { name: '게임 닫기', exact: true }).click()
  mark('gameplay_end')

  await page.getByRole('button', { name: /게임팩/ }).click()
  await page.locator('.library-overview').waitFor({ state: 'visible', timeout: 10_000 })
  const gameCard = page.locator('.game-card').filter({ hasText: chosenGame.title }).first()
  await gameCard.waitFor({ state: 'visible', timeout: 10_000 })
  await gameCard.click()
  await page.locator('.library-detail').waitFor({ state: 'visible', timeout: 10_000 })
  mark('created_game_selected')
  await sleep(900)

  await page.getByRole('button', { name: /오락실 배포.*20명 시뮬레이션/ }).click()
  mark('deploy_clicked')
  await page.waitForFunction(gameId => {
    const arcade = window.__dotcade?.store?.getState?.().arcade
    return arcade?.gameId === gameId && arcade.status === 'running'
  }, chosenGame.id, { timeout: 30_000 })
  mark('simulation_running')

  // Show the agents navigating the arcade, then return to the evidence panel.
  await page.waitForFunction(() => (window.__dotcade?.store?.getState?.().arcade?.progress || 0) >= 2, null, { timeout: timeoutMs })
  mark('progress_2')
  const collapse = page.locator('.panel.side.wide .panel-head .x').first()
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click()
    mark('world_view')
    await sleep(5200)
  }
  const reopen = page.getByRole('button', { name: /플레이 테스트/ }).first()
  if (await reopen.isVisible().catch(() => false)) await reopen.click()
  await page.locator('.panel.side.wide').waitFor({ state: 'visible', timeout: 10_000 })
  mark('live_panel')

  let lastProgress = -1
  let markedSummarizing = false
  const milestones = new Set([5, 10, 15, 20])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const arcade = window.__dotcade?.store?.getState?.().arcade
      return arcade ? {
        status: arcade.status,
        progress: arcade.progress || 0,
        validReports: arcade.validReports || 0,
        avg: arcade.avg ?? null,
        reports: arcade.reports?.length || 0,
        summaryLength: (arcade.summary || '').length,
        summaryStreamLength: (arcade.summaryStream || '').length
      } : null
    })
    if (!state) throw new Error('arcade state disappeared during simulation')
    if (state.progress !== lastProgress) {
      lastProgress = state.progress
      for (const milestone of milestones) {
        if (state.progress >= milestone && !marks.some(item => item.label === `progress_${milestone}`)) {
          mark(`progress_${milestone}`, { validReports: state.validReports })
        }
      }
    }
    if (state.status === 'summarizing' && !markedSummarizing) {
      markedSummarizing = true
      mark('summarizing', state)
    }
    if (state.status === 'done' && state.progress === 20 && state.reports === 20 && state.summaryLength > 0) break
    if (['cancelled', 'error'].includes(state.status)) throw new Error(`simulation ended as ${state.status}`)
    await sleep(350)
  }

  const completed = await page.evaluate(() => {
    const arcade = window.__dotcade.store.getState().arcade
    return {
      status: arcade?.status,
      progress: arcade?.progress || 0,
      validReports: arcade?.validReports || 0,
      reports: arcade?.reports?.length || 0,
      avg: arcade?.avg ?? null,
      summaryLength: (arcade?.summary || '').length,
      ratings: arcade?.ratings || null
    }
  })
  if (completed.status !== 'done' || completed.progress !== 20 || completed.reports !== 20 || completed.summaryLength < 1) {
    throw new Error(`simulation completion timeout: ${JSON.stringify(completed)}`)
  }
  mark('report_done', completed)

  // The modal is the immediate feedback view. Capture both its overview and
  // lower recommendations before proving that the report persisted to the pack.
  await page.locator('.report-modal').waitFor({ state: 'visible', timeout: 20_000 })
  const reportBody = page.locator('.report-modal .report-body')
  await reportBody.evaluate(element => element.scrollTo(0, 0))
  mark('report_overview')
  await sleep(6200)
  await reportBody.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
  mark('report_recommendations')
  await sleep(5200)

  await page.locator('.report-modal .modal-head .x').click()
  const arcadeCollapse = page.locator('.panel.side.wide .panel-head .x').first()
  if (await arcadeCollapse.isVisible().catch(() => false)) await arcadeCollapse.click()
  await page.getByRole('button', { name: /게임팩/ }).click()
  await page.locator('.game-card').filter({ hasText: chosenGame.title }).first().click()
  await page.getByRole('button', { name: '오락실 피드백', exact: true }).click()
  await page.locator('.fb-version').first().waitFor({ state: 'visible', timeout: 15_000 })
  const persisted = await page.evaluate(({ gameId, version }) => fetch('/api/games')
    .then(response => response.json())
    .then(data => {
      const game = data.games?.find(item => item.id === gameId)
      const feedback = game?.feedback?.[version]
      return {
        found: !!feedback,
        reports: feedback?.reports?.length || 0,
        avg: feedback?.avg ?? null,
        summaryLength: (feedback?.summary || '').length
      }
    }), { gameId: chosenGame.id, version: chosenGame.version })
  if (!persisted.found || persisted.reports !== 20 || persisted.summaryLength < 1) {
    throw new Error(`feedback was not persisted: ${JSON.stringify(persisted)}`)
  }
  mark('persistent_feedback', persisted)
  await sleep(7600)
  mark('scene_end')
} finally {
  await context.close()
  await video.saveAs(output)
  await browser.close()
  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    output: path.relative(root, output),
    viewport: size,
    game: chosenGame,
    durationSeconds: round((Date.now() - startedAt) / 1000),
    marks
  }
  await writeFile(marksOutput, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`RECORDING_SAVED ${output}`)
  console.log(`MARKS_SAVED ${marksOutput}`)
}
