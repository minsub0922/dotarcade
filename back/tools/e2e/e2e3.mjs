import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
for (const id of ['meteor-dodge', 'snake-classic']) {
  const pg = await b.newPage({ viewport: { width: 460, height: 720 } })
  let fatal = null
  pg.on('console', m => { if (m.text().includes('fatal')) fatal = m.text() })
  await pg.goto('http://localhost:5175/play/' + id, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(2800)
  // 캔버스 픽셀 painted 여부: iframe 내부 접근 불가(sandbox) → 스크린샷 밝기로 판단
  await pg.screenshot({ path: `/tmp/e2e3_${id}.png` })
  const title = await pg.textContent('#t')
  console.log(id, '→', title, fatal || 'no-fatal')
  await pg.close()
}
await b.close()
