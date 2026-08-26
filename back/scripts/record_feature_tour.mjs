import { chromium } from 'playwright'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const rawDir = path.join(root, 'artifacts/video/raw')
const manifestPath = path.join(rawDir, 'recording-manifest.json')
const baseUrl = process.env.DOTCADE_URL || 'http://127.0.0.1:4177/'
const size = { width: 1280, height: 720 }
const onlySegment = process.env.DOTCADE_ONLY || ''
const recordRequested = process.env.DOTCADE_RECORD === '1'
const integrationReady = process.env.DOTCADE_INTEGRATION_READY === '1'
const onlinePreflight = process.env.DOTCADE_PREFLIGHT_ONLINE === '1'
const teamIds = ['pm', 'designer', 'writer', 'dev1', 'dev2']
const plannedSegments = [
  '01_walk',
  '02_vehicles',
  '03_impacts',
  '04_social',
  '05_pocket',
  '06_simulation',
  '07_meeting',
  '08_report'
]

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const round = value => Math.round(Number(value) * 1000) / 1000

async function exists(file) {
  try {
    await access(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function preflight() {
  const required = [
    'front/web/src/engine/avatarAnimation.js',
    'front/web/src/engine/npcReactions.js',
    'front/web/src/engine/handheldVisuals.js',
    'front/web/src/engine/npcPlanner.js',
    'front/web/src/arcade/sim.js',
    'front/web/src/meeting/engine.js',
    'front/web/public/assets/sprites_v2/player/walk-sheet.png',
    'front/web/public/assets/sprites_v2/v20/walk-sheet.png'
  ]
  const files = Object.fromEntries(await Promise.all(required.map(async relative => [relative, await exists(path.join(root, relative))])))
  const browserExecutable = chromium.executablePath()
  const browserAvailable = await exists(browserExecutable)
  let app = { checked: false, reachable: null, status: null }

  if (onlinePreflight) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4500)
    try {
      const response = await fetch(baseUrl, { signal: controller.signal })
      app = { checked: true, reachable: response.ok, status: response.status }
    } catch (error) {
      app = { checked: true, reachable: false, status: error.name || String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  const report = {
    mode: recordRequested && integrationReady ? 'record' : 'preflight-only',
    baseUrl,
    viewport: size,
    plannedSegments,
    integrationReady,
    browserAvailable,
    browserExecutable,
    files,
    app
  }
  console.log(`PREFLIGHT ${JSON.stringify(report, null, 2)}`)
  if (!browserAvailable || Object.values(files).some(value => !value)) {
    throw new Error('feature-tour preflight failed: browser or required integrated feature assets are missing')
  }
  if (onlinePreflight && !app.reachable) throw new Error(`feature-tour preflight failed: ${baseUrl} is not reachable`)
  return report
}

await mkdir(rawDir, { recursive: true })
await preflight()

if (recordRequested && !integrationReady) {
  throw new Error('recording is locked until DOTCADE_INTEGRATION_READY=1 is provided')
}
if (!recordRequested) {
  console.log('RECORDING_SKIPPED Set DOTCADE_RECORD=1 and DOTCADE_INTEGRATION_READY=1 after integration QA passes.')
  process.exit(0)
}

const browser = await chromium.launch({ headless: true })
let sharedState
let previousManifest = null
if (onlySegment && await exists(manifestPath)) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (parsed.schemaVersion === 2) previousManifest = parsed
  } catch (error) {
    console.warn(`MANIFEST_MERGE_SKIPPED ${error.message}`)
  }
}
const manifest = {
  ...(previousManifest || {}),
  schemaVersion: 2,
  createdAt: previousManifest?.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  baseUrl,
  viewport: size,
  seed: previousManifest?.seed || 0xD07CADE,
  plannedSegments,
  selectedSegment: onlySegment || null,
  segments: { ...(previousManifest?.segments || {}) }
}

async function saveManifest() {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function mark(segment, event, startedAt, extra = null) {
  const at = round((Date.now() - startedAt) / 1000)
  const item = { event, at }
  if (extra != null) item.extra = extra
  manifest.segments[segment] ||= { marks: [] }
  manifest.segments[segment].marks.push(item)
  console.log(`MARK ${segment} ${event} ${at.toFixed(3)}${extra == null ? '' : ` ${JSON.stringify(extra)}`}`)
  return item
}

async function newContext(recordVideo = false) {
  const context = await browser.newContext({
    viewport: size,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    storageState: sharedState,
    ...(recordVideo ? { recordVideo: { dir: rawDir, size } } : {})
  })
  // Stable frontend randomness keeps planner choices and reaction dialogue
  // reproducible. Network/LLM timing is handled independently by phase marks.
  await context.addInitScript(seed => {
    let state = seed >>> 0
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
  }, manifest.seed)
  return context
}

async function waitForApp(page) {
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForFunction(() => {
    const d = window.__dotcade
    return !!(d?.eng?.player && d?.store?.getState && d?.meet && d?.sim)
  }, null, { timeout: 20_000 })
  await sleep(900)
  const close = page.locator('.modal-back .modal .x').first()
  if (await close.isVisible().catch(() => false)) await close.click()
}

async function bootstrap() {
  const context = await newContext(false)
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  await page.evaluate(() => {
    const store = window.__dotcade.store.getState()
    store.setSettings?.({ autoApprove: true, simConcurrency: 8 })
    const key = `dotcade-visited-${store.config?.profile || 'local'}`
    localStorage.setItem(key, '1')
  })
  sharedState = await context.storageState()
  await context.close()
}

async function stageOffice(page, spawn = [8, 18], zoom = 1.22) {
  await page.evaluate(({ spawn, zoom, teamIds }) => {
    const d = window.__dotcade
    const eng = d.eng
    eng.settleFreeRoam({ silent: true })
    eng.setMap('office', spawn)
    d.store.getState().setMap('office')
    eng.setZoom(zoom)
    eng.npcReactions.reset(eng.agents)
    for (const id of teamIds) {
      const agent = eng.agent(id)
      if (!agent) continue
      eng.suspendAutonomy(id, 'feature-video')
      agent.visible = true
      agent.map = 'office'
      agent.path = []
      agent.cb = null
      agent.sitting = false
      agent.bubble = null
      agent.meta.speaking = false
    }
    eng.player.path = []
    eng.player.sitting = false
    eng.player.dir = 'right'
    eng.centerCamera(true)
  }, { spawn, zoom, teamIds })
  await sleep(500)
}

async function waitForPlayer(page, timeout = 8000) {
  await page.waitForFunction(() => {
    const player = window.__dotcade?.eng?.player
    return !!player && !player.moving && (!player.path || player.path.length === 0)
  }, null, { timeout })
}

async function autoWalk(page, tile, timeout = 8000) {
  const pathLength = await page.evaluate(target => {
    const eng = window.__dotcade.eng
    eng.playerAutoWalk(target)
    return eng.player.path.length
  }, tile)
  if (!pathLength) throw new Error(`playerAutoWalk found no route to ${tile.join(',')}`)
  await sleep(120)
  await waitForPlayer(page, timeout)
}

async function waitForReaction(page, sourceId, agentId, timeout = 5000) {
  await page.waitForFunction(({ sourceId, agentId }) => {
    return window.__dotcade.eng.getReactionEvidence().some(item => item.source?.id === sourceId && item.agent?.id === agentId)
  }, { sourceId, agentId }, { timeout })
  return page.evaluate(({ sourceId, agentId }) => {
    return window.__dotcade.eng.getReactionEvidence().findLast(item => item.source?.id === sourceId && item.agent?.id === agentId)
  }, { sourceId, agentId })
}

async function recordSegment(name, run) {
  const context = await newContext(true)
  const page = await context.newPage()
  const video = page.video()
  const startedAt = Date.now()
  manifest.segments[name] = { status: 'recording', marks: [] }
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  mark(name, 'ready', startedAt)

  let failure = null
  try {
    await run(page, startedAt)
  } catch (error) {
    failure = error
    mark(name, 'error', startedAt, { message: error.message })
    console.error(`SEGMENT_ERROR ${name}`, error)
    await sleep(1500)
  }

  sharedState = await context.storageState()
  await context.close()
  const output = path.join(rawDir, `${name}.webm`)
  await video.saveAs(output)
  const segment = manifest.segments[name]
  segment.status = failure ? 'saved-with-error' : 'saved'
  segment.output = output
  segment.durationSeconds = round((Date.now() - startedAt) / 1000)
  await saveManifest()
  console.log(`SEGMENT_SAVED ${name} ${output}`)
  if (failure && process.env.DOTCADE_CONTINUE_ON_ERROR !== '1') throw failure
  return { output, failure }
}

await bootstrap()

if (!onlySegment || onlySegment === '01_walk') await recordSegment('01_walk', async (page, startedAt) => {
  await stageOffice(page, [8, 18], 1.3)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const designer = eng.agent('designer')
    const dev1 = eng.agent('dev1')
    designer.x = 17 * 48 + 24; designer.y = 17 * 48 + 42; designer.dir = 'left'
    dev1.x = 7 * 48 + 24; dev1.y = 17 * 48 + 42; dev1.dir = 'right'
    eng.goTo('designer', [10, 17])
    eng.goTo('dev1', [16, 17])
  })
  mark('01_walk', 'scene_start', startedAt)
  await autoWalk(page, [16, 18])
  await sleep(350)
  await autoWalk(page, [10, 18])
  await sleep(300)
  await autoWalk(page, [10, 14])
  await sleep(280)
  await autoWalk(page, [10, 18])
  await sleep(850)
  mark('01_walk', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '02_vehicles') await recordSegment('02_vehicles', async (page, startedAt) => {
  // Keep the rider in the upper two thirds so the explanatory caption never
  // hides mount, pedal, kick-push or dismount poses.
  await stageOffice(page, [7, 12], 1.24)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const bike = eng.worldObject('office-bike')
    const scooter = eng.worldObject('office-scooter')
    bike.x = 8 * 48 + 24; bike.y = 12 * 48 + 42; bike.dir = 'right'; bike.mounted = false
    scooter.x = 18 * 48 + 24; scooter.y = 12 * 48 + 42; scooter.dir = 'right'; scooter.mounted = false
  })
  mark('02_vehicles', 'scene_start', startedAt)
  await sleep(850)
  const bikeMounted = await page.evaluate(() => window.__dotcade.eng.mountVehicle('office-bike'))
  if (!bikeMounted) throw new Error('bike mount failed')
  mark('02_vehicles', 'bike_mount', startedAt)
  await autoWalk(page, [14, 12])
  await sleep(550)
  await page.evaluate(() => window.__dotcade.eng.dismountVehicle())
  await sleep(650)
  mark('02_vehicles', 'bike_end', startedAt)

  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const scooter = eng.worldObject('office-scooter')
    eng.player.x = scooter.x - 40
    eng.player.y = scooter.y
    eng.player.dir = 'right'
    eng.player.path = []
    eng.centerCamera(true)
  })
  await sleep(700)
  const scooterMounted = await page.evaluate(() => window.__dotcade.eng.mountVehicle('office-scooter'))
  if (!scooterMounted) throw new Error('scooter mount failed')
  mark('02_vehicles', 'scooter_mount', startedAt)
  await autoWalk(page, [24, 12])
  await sleep(450)
  await page.evaluate(() => window.__dotcade.eng.dismountVehicle())
  await sleep(650)
  mark('02_vehicles', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '03_impacts') await recordSegment('03_impacts', async (page, startedAt) => {
  await stageOffice(page, [10, 12], 1.34)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const target = eng.agent('designer')
    const book = eng.worldObject('office-book-a')
    for (const id of ['pm', 'writer', 'dev1', 'dev2']) eng.agent(id).visible = false
    // The collision gate is intentionally disabled near the top of the arc;
    // 60px places the actor inside the book's initial readable hit window.
    target.x = eng.player.x + 60; target.y = eng.player.y; target.dir = 'left'
    book.x = eng.player.x + 10; book.y = eng.player.y; book.z = 0; book.vx = 0; book.vy = 0
    eng.player.dir = 'right'
    eng.npcReactions.random = () => .5 // deterministic knockback + follow-up
  })
  mark('03_impacts', 'scene_start', startedAt)
  await sleep(650)
  const bookPicked = await page.evaluate(() => window.__dotcade.eng.pickupObject('office-book-a'))
  if (!bookPicked) throw new Error('book pickup failed')
  await sleep(700)
  mark('03_impacts', 'book_throw', startedAt)
  await page.evaluate(() => window.__dotcade.eng.throwHeld())
  const bookReaction = await waitForReaction(page, 'office-book-a', 'designer')
  mark('03_impacts', 'book_hit', startedAt, { reaction: bookReaction?.reaction, emotion: bookReaction?.emotion })
  await sleep(2350)

  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const target = eng.agent('dev1')
    eng.agent('designer').visible = false
    target.visible = true
    const trash = eng.worldObject('office-trash')
    eng.player.x = 10 * 48 + 24; eng.player.y = 12 * 48 + 42; eng.player.dir = 'right'; eng.player.path = []
    target.x = eng.player.x + 60; target.y = eng.player.y; target.dir = 'left'; target.path = []
    trash.x = eng.player.x + 10; trash.y = eng.player.y; trash.z = 0; trash.vx = 0; trash.vy = 0
    eng.npcReactions.random = () => .92 // deterministic stun/dizzy expression
    eng.centerCamera(true)
  })
  await sleep(600)
  const trashPicked = await page.evaluate(() => window.__dotcade.eng.pickupObject('office-trash'))
  if (!trashPicked) throw new Error('trash pickup failed')
  await sleep(700)
  mark('03_impacts', 'trash_throw', startedAt)
  await page.evaluate(() => window.__dotcade.eng.throwHeld())
  const trashReaction = await waitForReaction(page, 'office-trash', 'dev1')
  mark('03_impacts', 'trash_hit', startedAt, { reaction: trashReaction?.reaction, emotion: trashReaction?.emotion })
  await sleep(2550)
  mark('03_impacts', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '04_social') await recordSegment('04_social', async (page, startedAt) => {
  await stageOffice(page, [11, 12], 1.36)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const writer = eng.agent('writer')
    const pm = eng.agent('pm')
    writer.x = 11 * 48 + 24; writer.y = 12 * 48 + 42; writer.dir = 'right'; writer.path = []
    pm.x = 13 * 48 + 24; pm.y = 12 * 48 + 42; pm.dir = 'left'; pm.path = []
    eng.resumeAutonomy('writer')
    writer.autonomy.suspendedBy = null
    if (writer.autonomy.currentGoal) eng._finishAutonomyGoal(writer, 'cancelled', 'feature-video')
    // Establish the readable portrait expressions before social-start cues can
    // consume the per-avatar emotion cooldown.
    eng.expressEmotion('writer', 'happy', { source: 'video-social-writer', durationMs: 3000 })
    eng.expressEmotion('pm', 'proud', { source: 'video-social-pm', durationMs: 3000 })
    eng._beginAutonomyGoal(writer, { kind: 'socialize', targetId: 'pm', maxTurns: 3, utility: 2 })
    eng.emote('writer', true)
    eng.centerCamera(true)
  })
  mark('04_social', 'scene_start', startedAt)
  await page.waitForFunction(() => !!window.__dotcade.eng.agent('writer')?.meta?.socialLock, null, { timeout: 4000 })
  mark('04_social', 'dialogue_start', startedAt)
  await sleep(1250)
  await page.evaluate(() => {
    const e = window.__dotcade.eng
    e.emote('writer', false); e.emote('pm', true)
  })
  await sleep(1250)
  await page.evaluate(() => { const e = window.__dotcade.eng; e.emote('pm', false); e.emote('writer', true) })
  await sleep(1450)
  await page.evaluate(() => window.__dotcade.eng.emote('writer', false))
  await sleep(800)
  mark('04_social', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '05_pocket') await recordSegment('05_pocket', async (page, startedAt) => {
  await stageOffice(page, [8, 18], 1.2)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const dev2 = eng.agent('dev2')
    dev2.x = 12 * 48 + 24; dev2.y = 18 * 48 + 42; dev2.dir = 'down'; dev2.path = []
    eng.setHandheld('dev2', { active: true, title: '픽셀 러너', state: 'playing' })
    eng.bubble('dev2', '휴대기로 조작감 먼저 볼게요! ▣', 2600)
    eng.centerCamera(true)
  })
  mark('05_pocket', 'scene_start', startedAt)
  mark('05_pocket', 'npc_pocket', startedAt)
  await sleep(2100)
  await page.evaluate(() => {
    const eng = window.__dotcade.eng
    const station = eng.worldObject('office-pocket')
    eng.player.x = station.x + 52
    eng.player.y = station.y
    eng.player.path = []
    eng.player.dir = 'left'
    eng.centerCamera(true)
  })
  await sleep(850)
  mark('05_pocket', 'station', startedAt)
  await page.keyboard.press('KeyE')
  await page.getByText('픽셀 러너', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await sleep(750)
  await page.getByText('픽셀 러너', { exact: true }).click()
  await sleep(600)
  mark('05_pocket', 'library', startedAt)
  await page.getByRole('button', { name: '▣ POCKET에서 시작', exact: true }).click()
  await page.locator('.portable-play-shell iframe').waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(900)
  mark('05_pocket', 'gameplay', startedAt)
  await page.locator('.portable-play-shell iframe').click({ position: { x: 260, y: 150 } }).catch(() => {})
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i % 2 ? 'ArrowRight' : 'Space').catch(() => {})
    await sleep(650)
  }
  await sleep(850)
  mark('05_pocket', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '06_simulation') await recordSegment('06_simulation', async (page, startedAt) => {
  await page.evaluate(() => window.__dotcade.store.getState().setSettings?.({ simConcurrency: 8 }))
  await page.getByRole('button', { name: /게임팩/ }).click()
  await page.getByText('픽셀 러너', { exact: true }).click()
  await page.getByRole('button', { name: /오락실 배포/ }).click()
  mark('06_simulation', 'run_start', startedAt)
  await page.waitForFunction(() => {
    const state = window.__dotcade?.store?.getState?.().arcade
    return state?.status === 'running' && (state.playing?.length || 0) > 0
  }, null, { timeout: 20_000 })
  await sleep(3900)
  mark('06_simulation', 'routing_panel', startedAt)
  const collapse = page.locator('.panel-head .x').last()
  if (await collapse.isVisible().catch(() => false)) await collapse.click()
  mark('06_simulation', 'world_view', startedAt)
  await sleep(7200)
  mark('06_simulation', 'world_end', startedAt)
  const reopen = page.getByRole('button', { name: /플레이 테스트/ })
  if (await reopen.isVisible().catch(() => false)) await reopen.click()
  await page.locator('.venue-badge').first().waitFor({ state: 'visible', timeout: 10_000 })
  mark('06_simulation', 'live_panel', startedAt)
  await sleep(10_500)
  mark('06_simulation', 'live_evidence', startedAt)
  const stop = page.getByRole('button', { name: '시뮬레이션 중단', exact: true })
  if (await stop.isVisible().catch(() => false)) await stop.click()
  mark('06_simulation', 'cancelled', startedAt)
  await sleep(1800)
  mark('06_simulation', 'scene_end', startedAt)
})

if (!onlySegment || onlySegment === '07_meeting') await recordSegment('07_meeting', async (page, startedAt) => {
  const agenda = '붕어빵 캐처: 떨어지는 붕어빵을 좌우로 받아 콤보를 만들고 폭탄은 피하는 손맛 좋은 겨울 간식 게임'
  await page.getByRole('button', { name: /새 회의 · 게임 만들기/ }).click()
  await page.getByRole('textbox').fill(agenda)
  await sleep(900)
  mark('07_meeting', 'agenda_ready', startedAt)
  await page.getByRole('button', { name: '🚀 회의 소집', exact: true }).click()
  mark('07_meeting', 'run_start', startedAt)

  let lastPhase = ''
  let choseDirection = false
  let approved = false
  let terminal = null
  const meetingAppearDeadline = Date.now() + 20_000
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const meeting = window.__dotcade?.store?.getState?.().meeting
      return meeting ? {
        phase: meeting.phase,
        status: meeting.status,
        directionGate: !!meeting.directionGate,
        approval: !!meeting.approval,
        resultGameId: meeting.resultGameId || null,
        error: meeting.error || ''
      } : null
    })
    if (!state) {
      if (Date.now() < meetingAppearDeadline) {
        await sleep(250)
        continue
      }
      throw new Error('meeting state did not appear')
    }
    if (state.phase !== lastPhase) {
      lastPhase = state.phase
      mark('07_meeting', `phase_${state.phase}`, startedAt)
    }
    if (state.directionGate && !choseDirection) {
      choseDirection = true
      const recommended = page.locator('.direction-card.recommended')
      await recommended.waitFor({ state: 'visible', timeout: 10_000 })
      await sleep(1200)
      await recommended.click()
      mark('07_meeting', 'direction_selected', startedAt)
    }
    if (state.approval && !approved) {
      approved = true
      const button = page.locator('.approval-go')
      await button.waitFor({ state: 'visible', timeout: 10_000 })
      await sleep(1100)
      await button.click()
      mark('07_meeting', 'implementation_approved', startedAt)
    }
    if (['done', 'error', 'cancelled'].includes(state.status)) {
      terminal = state
      break
    }
    await sleep(400)
  }
  if (!terminal) throw new Error('meeting recording deadline exceeded')
  mark('07_meeting', `terminal_${terminal.status}`, startedAt, { error: terminal.error || '' })
  await sleep(2200)
  if (terminal.status !== 'done') throw new Error(`meeting ended as ${terminal.status}: ${terminal.error}`)

  const playButton = page.locator('.panel-foot button.primary').filter({ hasText: '플레이' }).first()
  await playButton.waitFor({ state: 'visible', timeout: 10_000 })
  await playButton.click()
  await page.locator('.play-host iframe').waitFor({ state: 'visible', timeout: 15_000 })
  await sleep(1000)
  mark('07_meeting', 'generated_game_start', startedAt)
  await page.locator('.play-host iframe').click({ position: { x: 300, y: 170 } }).catch(() => {})
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(i % 3 === 0 ? 'ArrowRight' : i % 3 === 1 ? 'ArrowLeft' : 'Space').catch(() => {})
    await sleep(580)
  }
  await sleep(1200)
  mark('07_meeting', 'generated_game_end', startedAt)
})

if (!onlySegment || onlySegment === '08_report') await recordSegment('08_report', async (page, startedAt) => {
  await page.getByRole('button', { name: /게임팩/ }).click()
  await page.getByText('픽셀 러너', { exact: true }).click()
  const feedbackTab = page.getByRole('button', { name: '오락실 피드백', exact: true })
  await feedbackTab.click()
  mark('08_report', 'scene_start', startedAt)
  await sleep(8000)
  mark('08_report', 'scene_end', startedAt)
})

manifest.completedAt = new Date().toISOString()
await saveManifest()
await browser.close()
console.log(`RECORDING_COMPLETE ${manifestPath}`)
