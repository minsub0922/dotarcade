// 메테오 닷지 — DOTCADE 기본 게임 #2
// 조작: ←→↑↓ 우주선 이동. 운석을 피하고 별을 모으세요.
window.game = {
  meta: {
    title: '메테오 닷지',
    desc: '운석 소나기 속에서 살아남아 별을 모으는 우주 회피 게임.',
    controls: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    viewport: { w: 360, h: 480 }
  },
  _raf: 0,
  start(canvas, api) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const rng = api.rng
    let t = 0, score = 0, lives = 3, inv = 0, over = false
    let px = W / 2, py = H - 80
    let meteors = [], stars = [], bgStars = [], parts = [], shake = 0
    for (let i = 0; i < 40; i++) bgStars.push({ x: rng() * W, y: rng() * H, s: 0.4 + rng() * 1.6 })

    const keys = {}
    const kd = e => { keys[e.code] = true }
    const ku = e => { keys[e.code] = false }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    this._cleanup = () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }

    const boom = (x, y, c, n = 10) => { for (let i = 0; i < n; i++) parts.push({ x, y, vx: (rng() - .5) * 5, vy: (rng() - .5) * 5, l: 16 + rng() * 12, c }) }

    const loop = () => {
      if (over) return
      t++
      const diff = Math.min(1, t / 3600)
      if (t % Math.max(10, 26 - Math.floor(diff * 14)) === 0) {
        const big = rng() < 0.22
        meteors.push({ x: rng() * W, y: -20, vx: (rng() - .5) * (1 + diff), vy: 2 + rng() * 2.4 + diff * 2.4, r: big ? 16 : 8 + rng() * 5, rot: rng() * 6 })
      }
      if (t % 90 === 0) stars.push({ x: 20 + rng() * (W - 40), y: -14, vy: 1.6 + rng() * 1.2, tw: 0 })
      if (t % 6 === 0) { score += 1; api.reportScore(score) }

      const sp = 3.6
      if (keys.ArrowLeft) px -= sp
      if (keys.ArrowRight) px += sp
      if (keys.ArrowUp) py -= sp
      if (keys.ArrowDown) py += sp
      px = Math.max(14, Math.min(W - 14, px)); py = Math.max(60, Math.min(H - 24, py))

      for (const m of meteors) { m.x += m.vx; m.y += m.vy; m.rot += 0.05 }
      meteors = meteors.filter(m => m.y < H + 30)
      for (const s of stars) { s.y += s.vy; s.tw++ }
      stars = stars.filter(s => s.y < H + 20)
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.l-- }
      parts = parts.filter(p => p.l > 0)
      if (inv > 0) inv--

      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        if (inv <= 0 && Math.hypot(m.x - px, m.y - py) < m.r + 8) {
          lives--; inv = 80; shake = 10; boom(px, py, '#ff9d5c', 16); meteors.splice(i, 1)
          if (lives <= 0) { over = true }
        }
      }
      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i]
        if (Math.hypot(s.x - px, s.y - py) < 18) { score += 25; api.reportScore(score); boom(s.x, s.y, '#ffd24a', 8); stars.splice(i, 1) }
      }

      const sx = shake > 0 ? (rng() - .5) * shake : 0, sy = shake > 0 ? (rng() - .5) * shake : 0
      if (shake > 0) shake--
      ctx.save(); ctx.translate(sx, sy)
      ctx.fillStyle = '#0c0e1e'; ctx.fillRect(-10, -10, W + 20, H + 20)
      for (const b of bgStars) {
        b.y += b.s; if (b.y > H) { b.y = 0; b.x = rng() * W }
        ctx.fillStyle = b.s > 1.4 ? '#8a93c6' : '#3c4270'; ctx.fillRect(b.x, b.y, 2, 2)
      }
      for (const s of stars) {
        ctx.fillStyle = s.tw % 20 < 10 ? '#ffd24a' : '#fff0b0'
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(0.78)
        ctx.fillRect(-5, -5, 10, 10); ctx.restore()
      }
      for (const m of meteors) {
        ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot)
        ctx.fillStyle = '#9a6a4c'; ctx.fillRect(-m.r, -m.r, m.r * 2, m.r * 2)
        ctx.fillStyle = '#7a5038'; ctx.fillRect(-m.r + 3, -m.r + 3, m.r, m.r)
        ctx.fillStyle = '#c08a62'; ctx.fillRect(0, 0, m.r - 2, m.r - 2)
        ctx.restore()
      }
      // ship
      if (inv <= 0 || t % 8 < 5) {
        ctx.save(); ctx.translate(px, py)
        ctx.fillStyle = '#7dc7ff'; ctx.fillRect(-4, -14, 8, 10)
        ctx.fillStyle = '#4a9de0'; ctx.fillRect(-10, -4, 20, 10)
        ctx.fillStyle = '#2c6aa8'; ctx.fillRect(-14, 2, 6, 8); ctx.fillRect(8, 2, 6, 8)
        ctx.fillStyle = t % 6 < 3 ? '#ffb84a' : '#ff7a3c'
        ctx.fillRect(-4, 8, 3, 5 + (t % 6)); ctx.fillRect(2, 8, 3, 5 + ((t + 3) % 6))
        ctx.restore()
      }
      for (const p of parts) { ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 3, 3) }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace'
      ctx.fillText('SCORE ' + score, 10, 22)
      ctx.fillStyle = '#ff5a7a'; ctx.fillText('♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives)), W - 66, 22)
      ctx.restore()

      if (over) {
        api.gameOver(score)
        ctx.fillStyle = 'rgba(10,8,20,.6)'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#ff5a7a'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', W / 2, H / 2 - 8)
        ctx.fillStyle = '#fff'; ctx.font = '14px monospace'
        ctx.fillText('SCORE ' + score, W / 2, H / 2 + 18); ctx.textAlign = 'left'
        this._cleanup()
        return
      }
      this._raf = requestAnimationFrame(loop)
    }
    loop()
  },
  stop() { cancelAnimationFrame(this._raf); this._cleanup && this._cleanup() }
}
