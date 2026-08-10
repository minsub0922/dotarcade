// 픽셀 러너 — DOTCADE 기본 게임 #1
// 조작: Space/ArrowUp 점프(더블점프), ArrowDown 슬라이드
window.game = {
  meta: {
    title: '픽셀 러너',
    desc: '달리는 도트 러너! 선인장을 뛰어넘고 새를 피해 최대한 멀리 달리세요.',
    controls: ['Space', 'ArrowUp', 'ArrowDown'],
    viewport: { w: 480, h: 320 }
  },
  _raf: 0,
  start(canvas, api) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height, GROUND = H - 56
    const rng = api.rng
    let t = 0, speed = 4.2, score = 0, over = false
    let py = GROUND, vy = 0, jumps = 0, slide = 0, flash = 0
    let obstacles = [], clouds = [], particles = []
    for (let i = 0; i < 5; i++) clouds.push({ x: rng() * W, y: 24 + rng() * 90, s: 0.3 + rng() * 0.5 })

    const keys = {}
    const kd = e => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && !keys[e.code]) {
        if (jumps < 2 && !over) { vy = jumps === 0 ? -9.6 : -8.2; jumps++; puff(60, py, 5) }
      }
      keys[e.code] = true
      if (e.code === 'ArrowDown') slide = 1
    }
    const ku = e => { keys[e.code] = false; if (e.code === 'ArrowDown') slide = 0 }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    this._cleanup = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }

    function puff(x, y, n) { for (let i = 0; i < n; i++) particles.push({ x, y, vx: -1 - rng() * 2, vy: -rng() * 2, l: 14 + rng() * 10 }) }
    function spawn() {
      const kind = rng() < 0.68 ? 'cactus' : 'bird'
      if (kind === 'cactus') {
        const h = 22 + Math.floor(rng() * 3) * 10
        obstacles.push({ kind, x: W + 20, y: GROUND, w: 14 + (rng() < 0.3 ? 16 : 0), h })
      } else {
        obstacles.push({ kind, x: W + 20, y: GROUND - (rng() < 0.5 ? 34 : 58), w: 22, h: 14, flap: 0 })
      }
    }
    let nextSpawn = 60

    const loop = () => {
      if (over) return
      t++; speed = Math.min(11, 4.2 + t / 600); score = Math.floor(t / 3)
      if (t % 5 === 0) api.reportScore(score)
      if (--nextSpawn <= 0) { spawn(); nextSpawn = 55 + rng() * 70 - speed * 3 }

      vy += 0.52; py += vy
      if (py >= GROUND) { py = GROUND; vy = 0; jumps = 0 }
      const ph = slide && py >= GROUND ? 14 : 26
      const pw = 20, pxx = 54

      for (const o of obstacles) { o.x -= speed; if (o.kind === 'bird') { o.flap++; o.x -= 1.2 } }
      obstacles = obstacles.filter(o => o.x > -60)
      for (const p of particles) { p.x += p.vx; p.y += p.vy; p.l-- }
      particles = particles.filter(p => p.l > 0)
      for (const c of clouds) { c.x -= c.s; if (c.x < -60) { c.x = W + 40; c.y = 20 + rng() * 100 } }

      // collision
      for (const o of obstacles) {
        const ox = o.x, oy = o.kind === 'cactus' ? o.y - o.h : o.y
        const oh = o.kind === 'cactus' ? o.h : o.h
        if (pxx < ox + o.w - 4 && pxx + pw - 4 > ox && py - ph < oy + oh - 4 && py > oy + 4) {
          over = true; flash = 1
        }
      }

      // draw
      const night = Math.sin(t / 900) > 0.4
      ctx.fillStyle = night ? '#1a2038' : '#bfe8f5'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = night ? '#f5e9a0' : '#ffd24a'
      ctx.fillRect(W - 70, 34, 26, 26)
      ctx.fillStyle = night ? '#2c3454' : '#a5d8ea'
      for (const c of clouds) { ctx.fillRect(c.x, c.y, 44, 10); ctx.fillRect(c.x + 8, c.y - 8, 26, 10) }
      // ground
      ctx.fillStyle = night ? '#3a2f28' : '#c8996b'; ctx.fillRect(0, GROUND + 2, W, H - GROUND)
      ctx.fillStyle = night ? '#544438' : '#a87e50'
      for (let i = 0; i < 12; i++) ctx.fillRect(((i * 53 - t * speed) % (W + 40) + W + 40) % (W + 40) - 20, GROUND + 12 + (i % 3) * 10, 16, 3)
      ctx.strokeStyle = night ? '#6a5a48' : '#8a6a44'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, GROUND + 2); ctx.lineTo(W, GROUND + 2); ctx.stroke()
      // obstacles
      for (const o of obstacles) {
        if (o.kind === 'cactus') {
          ctx.fillStyle = '#3f9e58'
          ctx.fillRect(o.x, o.y - o.h, 12, o.h)
          ctx.fillRect(o.x - 7, o.y - o.h + 8, 7, 10); ctx.fillRect(o.x + 12, o.y - o.h + 14, 7, 10)
          if (o.w > 20) { ctx.fillRect(o.x + 18, o.y - o.h + 6, 12, o.h - 6) }
          ctx.fillStyle = '#2e7a42'; ctx.fillRect(o.x + 3, o.y - o.h + 3, 3, o.h - 6)
        } else {
          ctx.fillStyle = '#8a6ad8'
          const fl = Math.floor(o.flap / 6) % 2
          ctx.fillRect(o.x, o.y, 20, 10)
          ctx.fillRect(o.x + 4, o.y + (fl ? -7 : 7), 12, 7)
          ctx.fillStyle = '#fff'; ctx.fillRect(o.x + 15, o.y + 2, 3, 3)
        }
      }
      // player (little robot)
      ctx.save()
      ctx.translate(pxx, py)
      ctx.fillStyle = '#3ec6a8'
      ctx.fillRect(0, -ph, pw, ph)
      ctx.fillStyle = '#2a9a82'; ctx.fillRect(0, -ph, pw, 6)
      ctx.fillStyle = '#fff'; ctx.fillRect(12, -ph + 7, 5, 5)
      ctx.fillStyle = '#1a1a2a'; ctx.fillRect(14, -ph + 9, 2, 2)
      const leg = Math.floor(t / 5) % 2
      ctx.fillStyle = '#26806c'
      if (py >= GROUND && !slide) { ctx.fillRect(2, -4 + (leg ? 0 : 2), 6, 4); ctx.fillRect(12, -4 + (leg ? 2 : 0), 6, 4) }
      ctx.restore()
      for (const p of particles) { ctx.fillStyle = 'rgba(180,160,140,.7)'; ctx.fillRect(p.x, p.y, 4, 4) }
      // HUD
      ctx.fillStyle = night ? '#fff' : '#333'
      ctx.font = 'bold 16px monospace'
      ctx.fillText('SCORE ' + score, 12, 24)
      ctx.font = '11px monospace'
      ctx.fillText('SPACE 점프 ×2 · ↓ 슬라이드', 12, H - 10)

      if (over) {
        api.gameOver(score)
        ctx.fillStyle = 'rgba(20,16,28,.55)'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#ff5a7a'; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', W / 2, H / 2 - 10)
        ctx.fillStyle = '#fff'; ctx.font = '15px monospace'
        ctx.fillText('SCORE ' + score, W / 2, H / 2 + 18)
        ctx.textAlign = 'left'
        this._cleanup()
        return
      }
      this._raf = requestAnimationFrame(loop)
    }
    loop()
  },
  stop() { cancelAnimationFrame(this._raf); this._cleanup && this._cleanup() }
}
