// DOTCADE E2E — 이동 → 회의(BMAD 파이프라인) → 게임 생성 → 오락실 20명 시뮬레이션
import { chromium } from 'playwright'

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } })
pg.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0, 400)))
pg.on('console', m => { if (m.type() === 'error' && !m.text().includes('TUNNEL')) console.log('CONSOLE:', m.text().slice(0, 250)) })

await pg.goto('http://localhost:5175', { waitUntil: 'networkidle' })
await pg.waitForTimeout(2200)
// 도움말 닫기
const help = await pg.$('.modal .primary')
if (help) await help.click()
await pg.waitForTimeout(500)

// ---- 1) 이동 테스트 ----
log('이동 테스트')
const pos0 = await pg.evaluate(() => ({ x: window.__dotcade.eng.player.x, y: window.__dotcade.eng.player.y }))
await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(700); await pg.keyboard.up('ArrowRight')
await pg.keyboard.down('ArrowUp'); await pg.waitForTimeout(400); await pg.keyboard.up('ArrowUp')
const pos1 = await pg.evaluate(() => ({ x: window.__dotcade.eng.player.x, y: window.__dotcade.eng.player.y }))
log('플레이어 이동:', JSON.stringify(pos0), '→', JSON.stringify(pos1), pos1.x > pos0.x ? 'OK' : 'FAIL!')

// ---- 2) 기본 게임 플레이 모달 ----
log('기본 게임 플레이 테스트')
await pg.click('text=게임팩')
await pg.waitForTimeout(600)
await pg.click('.game-card >> nth=0')
await pg.waitForTimeout(400)
await pg.click('button:has-text("▶ 플레이")')
await pg.waitForTimeout(2500)
const score1 = await pg.textContent('.score-live').catch(() => 'X')
await pg.screenshot({ path: '/tmp/e2e_play.png' })
log('플레이 모달 score:', score1)
await pg.click('.modal.play .x'); await pg.waitForTimeout(300)
const lib = await pg.$('.modal .x'); if (lib) await lib.click()
await pg.waitForTimeout(300)

// ---- 3) 회의 시작 ----
log('회의 시작: 안건 제출')
await pg.click('button:has-text("회의 시작")')
await pg.waitForTimeout(500)
await pg.fill('textarea', '슬라임을 좌우로 움직여 떨어지는 별을 받는 귀여운 게임')
await pg.click('button:has-text("회의 소집")')
await pg.waitForTimeout(3000)
await pg.screenshot({ path: '/tmp/e2e_meeting_start.png' })

// 회의 완료 대기 (최대 150초)
let done = false
for (let i = 0; i < 75; i++) {
  await pg.waitForTimeout(2000)
  const st = await pg.evaluate(() => {
    const m = window.__dotcade ? (window.__zs || null) : null
    return null
  }).catch(() => null)
  const status = await pg.evaluate(() => {
    try { return JSON.stringify({ s: document.querySelector('.phase-dot.now')?.textContent, done: !!document.querySelector('button:has-text' ) }) } catch { return '{}' }
  }).catch(() => '{}')
  const phase = await pg.$eval('.phase-dot.now', el => el.textContent).catch(() => null)
  const deployBtn = await pg.$('button:has-text("오락실 배포")')
  if (i % 5 === 0) log('  회의 진행:', phase || '(완료?)')
  if (i === 8) await pg.screenshot({ path: '/tmp/e2e_meeting_mid.png' })
  if (deployBtn) { done = true; break }
  const err = await pg.$('.panel-foot .err')
  if (err) { log('회의 오류:', await err.textContent()); break }
}
await pg.screenshot({ path: '/tmp/e2e_meeting_done.png' })
log('회의 완료:', done)

if (done) {
  // ---- 4) 오락실 배포 & 시뮬레이션 ----
  log('오락실 배포!')
  await pg.click('button:has-text("오락실 배포")')
  await pg.waitForTimeout(4000)
  await pg.screenshot({ path: '/tmp/e2e_arcade_start.png' })
  let simDone = false
  for (let i = 0; i < 150; i++) {
    await pg.waitForTimeout(2000)
    const prog = await pg.evaluate(() => {
      const a = document.querySelector('.progress-row .tiny')
      return a ? a.textContent : ''
    }).catch(() => '')
    if (i % 5 === 0) log('  시뮬 진행:', prog)
    if (i === 10) await pg.screenshot({ path: '/tmp/e2e_arcade_mid.png' })
    const avg = await pg.$('.avg-badge')
    const doneBtn = await pg.$('button:has-text("사무실로 돌아가기")')
    if (avg && doneBtn) { simDone = true; break }
  }
  await pg.screenshot({ path: '/tmp/e2e_arcade_done.png' })
  log('시뮬 완료:', simDone)
  const avgText = await pg.$eval('.avg-badge', el => el.textContent).catch(() => 'N/A')
  log('평균 점수:', avgText)
  const nReports = await pg.$$eval('.report', els => els.length).catch(() => 0)
  log('피드백 카드 수:', nReports)
}

// ---- 5) 라이브러리 확인 (새 게임 + 버전/코드) ----
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
const games = await pg.evaluate(() => fetch('/api/games').then(r => r.json()).then(d => d.games.map(g => `${g.title} ${g.version} avg:${g.feedback?.[g.version]?.avg}`)))
log('게임 목록:', JSON.stringify(games, null, 1))

await b.close()
log('E2E 종료')
