// 스네이크 클래식 — DOTCADE 기본 게임 #3
// 조작: 방향키. 사과를 먹고 길어지세요. 벽/몸통 충돌 시 종료.
window.game = {
  meta: {
    title: '스네이크 클래식',
    desc: '고전 스네이크의 도트 리메이크. 골든 애플을 노리세요!',
    controls: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    viewport: { w: 400, h: 440 }
  },
  _raf: 0,
  start(canvas, api) {
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const rng = api.rng
    const N = 20, CELL = 20, TOP = 40
    let snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }]
    let dir = { x: 1, y: 0 }, nextDir = { x: 1, y: 0 }, queue = []
    let food = null, golden = null, goldenT = 0
    let score = 0, over = false, t = 0, stepMs = 140, acc = 0, last = 0, flash = 0

    const place = () => {
      while (true) {
        const p = { x: Math.floor(rng() * N), y: Math.floor(rng() * N) }
        if (!snake.some(s => s.x === p.x && s.y === p.y)) return p
      }
    }
    food = place()

    const kd = e => {
      const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code]
      if (!m) return
      queue.push({ x: m[0], y: m[1] })
      if (queue.length > 3) queue.shift()
      e.preventDefault && e.preventDefault()
    }
    window.addEventListener('keydown', kd)
    this._cleanup = () => window.removeEventListener('keydown', kd)

    const step = () => {
      while (queue.length) {
        const q = queue.shift()
        if (q.x !== -dir.x || q.y !== -dir.y) { nextDir = q; break }
      }
      dir = nextDir
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
      if (head.x < 0 || head.x >= N || head.y < 0 || head.y >= N || snake.some(s => s.x === head.x && s.y === head.y)) {
        over = true; return
      }
      snake.unshift(head)
      if (food && head.x === food.x && head.y === food.y) {
        score += 10; api.reportScore(score); food = place(); flash = 4
        stepMs = Math.max(70, stepMs - 2)
        if (!golden && rng() < 0.22) { golden = place(); goldenT = 46 }
      } else if (golden && head.x === golden.x && head.y === golden.y) {
        score += 50; api.reportScore(score); golden = null; flash = 8
      } else {
        snake.pop()
      }
      if (golden && --goldenT <= 0) golden = null
    }

    const loop = (ts) => {
      if (over) {
        api.gameOver(score)
        ctx.fillStyle = 'rgba(10,12,18,.6)'; ctx.fillRect(0, 0, W, H)
        ctx.fillStyle = '#ff5a7a'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center'
        ctx.fillText('GAME OVER', W / 2, H / 2 - 8)
        ctx.fillStyle = '#fff'; ctx.font = '14px monospace'
        ctx.fillText('SCORE ' + score, W / 2, H / 2 + 18); ctx.textAlign = 'left'
        this._cleanup()
        return
      }
      if (!last) last = ts
      acc += ts - last; last = ts; t++
      while (acc > stepMs) { acc -= stepMs; step(); if (over) break }

      ctx.fillStyle = '#10131f'; ctx.fillRect(0, 0, W, H)
      // header
      ctx.fillStyle = '#1c2136'; ctx.fillRect(0, 0, W, TOP - 4)
      ctx.fillStyle = '#7de0a0'; ctx.font = 'bold 15px monospace'
      ctx.fillText('SCORE ' + score, 10, 26)
      ctx.fillStyle = '#8a93c6'; ctx.font = '11px monospace'
      ctx.fillText('SPEED ' + Math.round(1000 / stepMs), W - 90, 26)
      // grid
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#161a2c' : '#141828'
        ctx.fillRect(x * CELL, TOP + y * CELL, CELL, CELL)
      }
      // food
      if (food) {
        ctx.fillStyle = '#ff5a5a'; ctx.fillRect(food.x * CELL + 4, TOP + food.y * CELL + 4, 12, 12)
        ctx.fillStyle = '#3f9e58'; ctx.fillRect(food.x * CELL + 9, TOP + food.y * CELL + 1, 3, 5)
      }
      if (golden) {
        const tw = t % 20 < 10
        ctx.fillStyle = tw ? '#ffd24a' : '#fff0b0'
        ctx.fillRect(golden.x * CELL + 3, TOP + golden.y * CELL + 3, 14, 14)
        ctx.fillStyle = '#c89a20'; ctx.font = '10px monospace'
        ctx.fillText(String(Math.ceil(goldenT / 7)), golden.x * CELL + 7, TOP + golden.y * CELL + 14)
      }
      // snake
      snake.forEach((s, i) => {
        const g = Math.max(0, 224 - i * 6)
        ctx.fillStyle = i === 0 ? '#a0f0c0' : `rgb(60,${g},130)`
        ctx.fillRect(s.x * CELL + 1, TOP + s.y * CELL + 1, CELL - 2, CELL - 2)
        if (i === 0) {
          ctx.fillStyle = '#10131f'
          const ex = dir.x === 1 ? 12 : dir.x === -1 ? 4 : 8
          const ey = dir.y === 1 ? 12 : dir.y === -1 ? 4 : 8
          ctx.fillRect(s.x * CELL + ex - 2, TOP + s.y * CELL + ey - 2, 3, 3)
          ctx.fillRect(s.x * CELL + ex + 3, TOP + s.y * CELL + ey - 2, 3, 3)
        }
      })
      if (flash > 0) { ctx.fillStyle = `rgba(255,240,160,${flash * 0.04})`; ctx.fillRect(0, TOP, W, H - TOP); flash-- }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  },
  stop() { cancelAnimationFrame(this._raf); this._cleanup && this._cleanup() }
}
