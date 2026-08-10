// DOTCADE E2E-2 — 1:1 대화 · 업그레이드 회의 · 공유 페이지 · 코드/디프 뷰어 · 문 이동
import { chromium } from 'playwright'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } })
pg.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0, 300)))

await pg.goto('http://localhost:5175', { waitUntil: 'networkidle' })
await pg.waitForTimeout(2400)
const help = await pg.$('.modal .primary'); if (help) await help.click()
await pg.waitForTimeout(400)

// ---- 1) 1:1 대화: 정우진 옆으로 순간이동 후 E ----
log('1:1 대화 테스트')
await pg.evaluate(() => {
  const eng = window.__dotcade.eng
  const a = eng.agent('dev2')
  eng.player.x = a.x - 40; eng.player.y = a.y
})
await pg.waitForTimeout(600)
const hintText = await pg.textContent('.hint-bar').catch(() => null)
log('힌트:', hintText)
await pg.keyboard.press('KeyE')
await pg.waitForTimeout(700)
await pg.fill('.input-row input', '우진님, 요즘 만들고 싶은 게임 있어요?')
await pg.keyboard.press('Enter')
await pg.waitForTimeout(3500)
const lastMsg = await pg.$$eval('.msg.ai .bubble-ui', els => els.map(e => e.textContent).pop()).catch(() => null)
log('정우진 응답:', (lastMsg || 'NONE').slice(0, 80))
await pg.screenshot({ path: '/tmp/e2e2_chat.png' })
await pg.click('.panel.side .x')
await pg.waitForTimeout(400)

// ---- 2) 문으로 오락실 이동/복귀 ----
log('문 이동 테스트')
await pg.evaluate(() => { const eng = window.__dotcade.eng; eng.player.x = 26 * 48 + 24; eng.player.y = 18 * 48 + 40 })
await pg.waitForTimeout(500)
const doorHint = await pg.textContent('.hint-bar').catch(() => null)
log('문 힌트:', doorHint)
await pg.keyboard.press('KeyE')
await pg.waitForTimeout(800)
const mapBadge = await pg.textContent('.map-badge')
log('현재 맵:', mapBadge)
await pg.screenshot({ path: '/tmp/e2e2_arcade_idle.png' })
await pg.keyboard.press('KeyE') // 문 앞이므로 다시 사무실
await pg.waitForTimeout(800)
log('복귀 맵:', await pg.textContent('.map-badge'))

// ---- 3) 업그레이드 회의 (별똥별 받기) ----
log('업그레이드 회의 시작')
await pg.click('button:has-text("회의 시작")')
await pg.waitForTimeout(500)
const opts = await pg.$$eval('select option', els => els.map(e => e.value))
const upId = opts.find(v => v.startsWith('game-'))
await pg.selectOption('select', upId)
await pg.fill('textarea', '오락실 피드백 반영: 콤보 시스템과 파워업 아이템을 추가하고 후반 난이도를 다듬자')
await pg.click('button:has-text("회의 소집")')
let done = false
for (let i = 0; i < 90; i++) {
  await pg.waitForTimeout(2000)
  const phase = await pg.$eval('.phase-dot.now', el => el.textContent).catch(() => null)
  if (i % 6 === 0) log('  진행:', phase || '(마무리)')
  if (await pg.$('button:has-text("오락실 배포")')) { done = true; break }
  const err = await pg.$('.panel-foot .err')
  if (err) { log('오류:', await err.textContent()); break }
}
log('업그레이드 회의 완료:', done)
const verInfo = await pg.evaluate(() => fetch('/api/games').then(r => r.json()).then(d => {
  const g = d.games.find(x => x.id.startsWith('game-'))
  return { title: g.title, version: g.version, versions: g.versions.map(v => v.v) }
}))
log('버전:', JSON.stringify(verInfo))
await pg.evaluate(() => { window.__dotcade && useStoreCleanup?.() }).catch(() => {})
const closeBtn = await pg.$('.panel-foot button:has-text("닫기")'); if (closeBtn) await closeBtn.click()
await pg.waitForTimeout(400)

// ---- 4) 코드 뷰어 + 버전 diff ----
log('코드 뷰어/디프 테스트')
await pg.click('button:has-text("게임팩")')
await pg.waitForTimeout(500)
await pg.click(`.game-card:has-text("${verInfo.title.slice(0, 6)}")`)
await pg.waitForTimeout(400)
await pg.click('.tabs button:has-text("코드")')
await pg.waitForTimeout(900)
const codeLen = await pg.$eval('.code-view pre.code', el => el.textContent.length).catch(() => 0)
log('game.js 코드 길이:', codeLen)
await pg.click('.tabs button:has-text("버전 로그")')
await pg.waitForTimeout(800)
const vrows = await pg.$$eval('.vrow', els => els.map(e => e.textContent.slice(0, 40)))
log('버전 로그:', JSON.stringify(vrows))
const diffBtn = await pg.$('.vrow button:has-text("diff")')
if (diffBtn) {
  await diffBtn.click(); await pg.waitForTimeout(900)
  const diffTxt = await pg.$eval('pre.code.diff', el => el.textContent.slice(0, 150)).catch(() => 'NONE')
  log('diff 출력:', diffTxt.replace(/\n/g, ' | ').slice(0, 140))
}
await pg.screenshot({ path: '/tmp/e2e2_versions.png' })
await pg.click('.modal-head .x')

// ---- 5) 공유 페이지 ----
log('공유 페이지 테스트')
const pg2 = await b.newPage({ viewport: { width: 500, height: 800 } })
await pg2.goto(`http://localhost:5175/play/${verInfo ? (await pg.evaluate(() => fetch('/api/games').then(r => r.json()).then(d => d.games.find(x => x.id.startsWith('game-')).id))) : 'pixel-runner'}`)
await pg2.waitForTimeout(2500)
const title2 = await pg2.textContent('#t')
log('공유 페이지 타이틀:', title2)
await pg2.screenshot({ path: '/tmp/e2e2_share.png' })
const scoreShare = await pg2.textContent('#score')
log('공유 페이지 점수 표시:', scoreShare)

await b.close()
log('E2E-2 종료')
