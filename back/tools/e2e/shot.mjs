import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } })
pg.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text().slice(0, 300)) })
pg.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0, 300)))
await pg.goto('http://localhost:5175', { waitUntil: 'networkidle' })
await pg.waitForTimeout(2500)
await pg.screenshot({ path: '/tmp/shot1_office.png' })
// close help modal if open
const btn = await pg.$('button.primary')
if (btn) { await btn.click(); await pg.waitForTimeout(800) }
await pg.screenshot({ path: '/tmp/shot2_office.png' })
await b.close()
console.log('done')
