import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } })
await pg.goto('http://localhost:5175', { waitUntil: 'networkidle' })
await pg.waitForTimeout(2600)
const help = await pg.$('.modal .primary')
if (help) { await pg.screenshot({ path: '/tmp/final_help.png' }); await help.click() }
await pg.waitForTimeout(2500)
await pg.screenshot({ path: '/tmp/final_office.png' })
// 게임팩 라이브러리
await pg.click('button:has-text("게임팩")'); await pg.waitForTimeout(600)
await pg.screenshot({ path: '/tmp/final_library.png' })
await pg.click('.modal-head .x'); await pg.waitForTimeout(300)
// 오락실 (어트랙트 모드)
await pg.click('button:has-text("오락실")'); await pg.waitForTimeout(900)
await pg.screenshot({ path: '/tmp/final_arcade_idle.png' })
await b.close()
console.log('shots ok')
