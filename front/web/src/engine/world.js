// DOTCADE — 캔버스 월드 엔진 (맵 렌더 · 이동 · 충돌 · 에이전트 · 말풍선)
import { astar, randomWalkable } from './pathfind.js'

const T = 48
const DIRS = ['down', 'left', 'right', 'up']
const ARCADE_ZONE = [8, 6, 24, 15]   // 손님이 배회하는 오락실 구역
const ARCADE_LINES = [
  '우와, 신작 나왔대!', '이 캐비닛 내 최고기록 있는데', '동전 챙겨왔지 ㅎㅎ', '오늘 신기록 간다',
  '🕹️ 이 게임 재밌겠다', '구경만 해도 재밌네', '한 판만 더...', '여기 분위기 좋다',
  '옆 사람 플레이 잘하네', '이따 랭킹 봐야지'
]

export class Engine {
  constructor(canvas, { maps, manifest, onHint, onInteract }) {
    this.cv = canvas
    this.ctx = canvas.getContext('2d')
    this.maps = maps
    this.manifest = manifest
    this.onHint = onHint || (() => {})
    this.onInteract = onInteract || (() => {})
    this.images = {}       // sprite images: id -> {down,left,right,up,face}
    this.mapImg = {}
    this.map = 'office'
    this.keys = new Set()
    this.player = this._ent('player', 'player', this.maps.office.spawn, 'down')
    this.player.speed = 4.4
    this.agents = new Map()
    this.freezePlayer = false
    this.meetingMode = false
    this.simMode = false
    this.cabinetLabels = {}   // cabinetIdx -> {title, emoji, color, playerName}
    this.marquee = null       // 배포 중 게임 {title emoji color}
    this._raf = 0
    this._last = 0
    this._hintKey = ''
    this.t = 0
  }

  // ---------- assets ----------
  async load(spriteIds) {
    const jobs = []
    const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src })
    for (const m of ['office', 'arcade']) {
      if (!this.mapImg[m]) jobs.push(img(`/assets/map_${m}.png`).then(i => { this.mapImg[m] = i }))
    }
    for (const id of spriteIds) {
      if (this.images[id]) continue
      this.images[id] = {}
      for (const d of [...DIRS, 'face']) {
        jobs.push(img(`/assets/sprites/${id}/${d}.png`).then(i => { this.images[id][d] = i }))
      }
    }
    await Promise.all(jobs)
  }

  _ent(id, sprite, tile, dir = 'down') {
    return {
      id, sprite, x: tile[0] * T + T / 2, y: tile[1] * T + T - 6, dir,
      path: [], speed: 3.0, moving: false, sitting: false,
      bubble: null, cb: null, state: 'idle', idleT: 2000 + Math.random() * 4000,
      label: '', color: '#fff', visible: true, home: null, meta: {}
    }
  }

  addAgent(id, sprite, tile, { label, color, home, map } = {}) {
    const e = this._ent(id, sprite, tile)
    e.label = label || id; e.color = color || '#fff'; e.home = home || null
    e.map = map || this.map
    this.agents.set(id, e)
    return e
  }
  removeAgent(id) { this.agents.delete(id) }
  agent(id) { return this.agents.get(id) }
  clearAgents() { this.agents.clear() }

  // 오락실 상시 손님: 시뮬레이션이 없어도 맵에 활기가 돌도록 배회 NPC 유지
  ensureArcadeAmbient(visitors) {
    for (const v of visitors) {
      const existed = this.agents.get(v.id)
      if (existed) { existed.meta.ambientArcade = true; continue }
      const spot = randomWalkable(this.maps.arcade.collision, ARCADE_ZONE) || this.maps.arcade.spawn
      const e = this.addAgent(v.id, v.id, spot, { label: `${v.name}(${v.age})`, color: '#c9d1ff', map: 'arcade' })
      e.meta.ambientArcade = true
      e.idleT = 800 + Math.random() * 6000
      e.dir = DIRS[Math.floor(Math.random() * DIRS.length)]
    }
  }

  grid() { return this.maps[this.map].collision }

  setMap(name, playerTile) {
    this.map = name
    if (playerTile) { this.player.x = playerTile[0] * T + T / 2; this.player.y = playerTile[1] * T + T - 6 }
    this.player.path = []
  }

  // ---------- agent commands ----------
  goTo(id, tile, cb) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    if (!e) return
    e.sitting = false
    const from = [Math.floor(e.x / T), Math.floor(e.y / T)]
    const path = astar(this.grid(), from, tile)
    e.path = path || []
    e.cb = cb || null
    if (!path || !path.length) { e.cb = null; cb && cb() }
  }
  sit(id, tile, face) {
    const e = this.agents.get(id); if (!e) return
    e.x = tile[0] * T + T / 2; e.y = tile[1] * T + T - 8
    e.dir = face || 'down'; e.sitting = true; e.path = []
  }
  face(id, dir) { const e = id === 'player' ? this.player : this.agents.get(id); if (e) e.dir = dir }
  playerAutoWalk(tile, cb) {
    const p = this.player
    const from = [Math.floor(p.x / T), Math.floor(p.y / T)]
    p.path = astar(this.grid(), from, tile) || []
    p.cb = cb || null
    if (!p.path.length) { p.cb = null; cb && cb() }
  }
  bubble(id, text, ttl = 4200) {
    const e = id === 'player' ? this.player : this.agents.get(id)
    if (e) e.bubble = text ? { text: String(text), until: performance.now() + ttl } : null
  }
  emote(id, on) { const e = this.agents.get(id); if (e) e.meta.speaking = on }

  // ---------- loop ----------
  start() {
    const tick = ts => {
      const dt = Math.min(50, ts - (this._last || ts)); this._last = ts; this.t += dt
      this.update(dt)
      this.draw()
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }
  stop() { cancelAnimationFrame(this._raf) }

  // ---------- update ----------
  _walkable(px, py) {
    const g = this.grid()
    for (const [ox, oy] of [[-9, -2], [9, -2], [-9, 8], [9, 8]]) {
      const tx = Math.floor((px + ox) / T), ty = Math.floor((py + oy) / T)
      if (!g[ty] || g[ty][tx] !== '.') return false
    }
    return true
  }

  update(dt) {
    const f = dt / 16.67
    // --- player ---
    const p = this.player
    if (this.freezePlayer && p.path && p.path.length) {
      const [tx, ty] = p.path[0]
      const gx = tx * T + T / 2, gy = ty * T + T - 6
      const ddx = gx - p.x, ddy = gy - p.y
      const dist = Math.hypot(ddx, ddy)
      if (dist < p.speed * f + 1) {
        p.x = gx; p.y = gy; p.path.shift()
        if (!p.path.length) { p.moving = false; const cb = p.cb; p.cb = null; cb && cb() }
      } else {
        p.x += (ddx / dist) * p.speed * f; p.y += (ddy / dist) * p.speed * f
        p.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : (ddy > 0 ? 'down' : 'up')
        p.moving = true
      }
    } else if (!this.freezePlayer) {
      let dx = 0, dy = 0
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy -= 1
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy += 1
      if (dx || dy) {
        const n = Math.hypot(dx, dy); dx /= n; dy /= n
        const nx = p.x + dx * p.speed * f, ny = p.y + dy * p.speed * f
        if (this._walkable(nx, p.y)) p.x = nx
        if (this._walkable(p.x, ny)) p.y = ny
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        p.moving = true
      } else p.moving = false
    } else p.moving = false

    // --- agents follow paths / idle ---
    for (const e of this.agents.values()) {
      if (e.map && e.map !== this.map) { if (e.bubble && performance.now() > e.bubble.until) e.bubble = null; continue }
      if (e.path.length) {
        const [tx, ty] = e.path[0]
        const gx = tx * T + T / 2, gy = ty * T + T - 6
        const ddx = gx - e.x, ddy = gy - e.y
        const dist = Math.hypot(ddx, ddy)
        if (dist < e.speed * f + 1) {
          e.x = gx; e.y = gy; e.path.shift()
          if (!e.path.length) { e.moving = false; const cb = e.cb; e.cb = null; cb && cb() }
        } else {
          e.x += (ddx / dist) * e.speed * f
          e.y += (ddy / dist) * e.speed * f
          e.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : (ddy > 0 ? 'down' : 'up')
          e.moving = true
        }
      } else if (!this.meetingMode && !this.simMode && this.map === 'office' && e.home && !e.meta.chatting) {
        // idle FSM: 대부분 자리, 가끔 배회
        e.idleT -= dt
        if (e.idleT <= 0) {
          e.idleT = 14000 + Math.random() * 30000
          const r = Math.random()
          if (e.sitting && r < 0.3) {
            const spot = randomWalkable(this.grid(), this.maps.office.wander)
            if (spot) this.goTo(e.id, spot, () => {
              setTimeout(() => {
                if (!this.meetingMode && e.home) this.goTo(e.id, e.home.desk, () => this.sit(e.id, e.home.desk, e.home.face))
              }, 2500 + Math.random() * 5000)
            })
          } else if (!e.sitting && e.home) {
            this.goTo(e.id, e.home.desk, () => this.sit(e.id, e.home.desk, e.home.face))
          } else if (e.ambient && Math.random() < 0.6) {
            this.bubble(e.id, e.ambient[Math.floor(Math.random() * e.ambient.length)], 3600)
          }
        }
      } else if (!this.simMode && e.map === 'arcade' && e.meta.ambientArcade && !e.meta.chatting) {
        // 오락실 손님 배회 FSM: 돌아다니기 · 캐비닛 구경 · 혼잣말
        e.idleT -= dt
        if (e.idleT <= 0) {
          e.idleT = 8000 + Math.random() * 16000
          const r = Math.random()
          if (r < 0.45) {
            const spot = randomWalkable(this.maps.arcade.collision, ARCADE_ZONE)
            if (spot) this.goTo(e.id, spot)
          } else if (r < 0.7) {
            const cabs = this.maps.arcade.cabinets
            const c = cabs[Math.floor(Math.random() * cabs.length)]
            this.goTo(e.id, c.spot, () => this.face(e.id, 'up'))
          } else {
            this.bubble(e.id, ARCADE_LINES[Math.floor(Math.random() * ARCADE_LINES.length)], 3400)
          }
        }
      }
      if (e.bubble && performance.now() > e.bubble.until) e.bubble = null
    }
    if (p.bubble && performance.now() > p.bubble.until) p.bubble = null

    // --- interaction hint ---
    this._computeHint()
  }

  _computeHint() {
    let hint = null
    const p = this.player
    const ptx = Math.floor(p.x / T), pty = Math.floor(p.y / T)
    if (this.map === 'office') {
      let best = null, bd = 1e9
      for (const e of this.agents.values()) {
        if (!e.visible || e.id.startsWith('v') || (e.map && e.map !== this.map)) continue
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d < T * 1.5 && d < bd) { bd = d; best = e }
      }
      if (best) hint = { type: 'agent', id: best.id, label: `${best.meta.shortName || best.label}와 대화` }
      const sh = this.maps.office.shelf
      if (!hint && sh.front.some(([x, y]) => Math.abs(x - ptx) <= 0 && Math.abs(y - pty) <= 0)) {
        hint = { type: 'shelf', label: '게임팩 진열대 열기' }
      }
      const door = this.maps.office.door
      if (!hint && door.approach.concat(door.tiles).some(([x, y]) => Math.abs(x - ptx) + Math.abs(y - pty) <= 1)) {
        hint = { type: 'door', label: '오락실로 이동' }
      }
    } else {
      const door = this.maps.arcade.door
      if (door.approach.concat(door.tiles).some(([x, y]) => Math.abs(x - ptx) + Math.abs(y - pty) <= 1)) {
        hint = { type: 'door', label: '사무실로 돌아가기' }
      }
      if (!hint) {
        for (const c of this.maps.arcade.cabinets) {
          if (Math.abs(c.spot[0] - ptx) <= 1 && Math.abs(c.spot[1] - pty) <= 1 && this.cabinetLabels[c.id]) {
            hint = { type: 'cabinet', id: c.id, label: `${this.cabinetLabels[c.id].title} 플레이` }
            break
          }
        }
      }
    }
    const key = hint ? hint.type + (hint.id || '') : ''
    if (key !== this._hintKey) { this._hintKey = key; this.onHint(hint) }
  }

  // ---------- draw ----------
  draw() {
    const { ctx, cv } = this
    ctx.imageSmoothingEnabled = false
    const bg = this.mapImg[this.map]
    ctx.fillStyle = '#0b0d16'; ctx.fillRect(0, 0, cv.width, cv.height)
    if (bg) ctx.drawImage(bg, 0, 0)

    if (this.map === 'arcade') this._drawCabinetScreens()
    if (this.map === 'office') this._drawShelfCartridges()

    // entities sorted by y
    const ents = [...this.agents.values()].filter(e => e.visible && (!e.map || e.map === this.map))
    ents.push(this.player)
    ents.sort((a, b) => a.y - b.y)
    for (const e of ents) this._drawEnt(e)
    for (const e of ents) if (e.bubble) this._drawBubble(e)

    // hint marker
    if (this._hintKey) {
      const p = this.player
      ctx.font = 'bold 15px "Segoe UI", sans-serif'
      const label = ' E '
      ctx.fillStyle = 'rgba(20,22,40,.9)'
      const w = 26
      ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - 118, w, 22, 6); ctx.fill()
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = '#ffd24a'; ctx.textAlign = 'center'
      ctx.fillText('E', p.x, p.y - 102)
      ctx.textAlign = 'left'
    }
  }

  _drawEnt(e) {
    const { ctx } = this
    const set = this.images[e.sprite]
    const img = set && (set[e.dir] || set.down)
    const bob = e.moving ? Math.sin(this.t / 55) * 2.5 : (e.sitting ? 0 : Math.sin(this.t / 480 + e.x) * 0.8)
    // shadow
    ctx.fillStyle = 'rgba(16,12,24,.32)'
    ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 16, 6, 0, 0, Math.PI * 2); ctx.fill()
    if (img) {
      const w = img.width, h = img.height
      ctx.drawImage(img, Math.round(e.x - w / 2), Math.round(e.y - h + 4 + bob))
    } else {
      ctx.fillStyle = e.color; ctx.fillRect(e.x - 12, e.y - 40, 24, 40)
    }
    // speaking ring
    if (e.meta && e.meta.speaking) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 20, 8, 0, 0, Math.PI * 2); ctx.stroke()
    }
    // label
    const isPlayer = e === this.player
    ctx.font = `bold 13px "Segoe UI", sans-serif`
    const name = isPlayer ? e.label || '나 (팀장)' : e.label
    if (name) {
      const tw = ctx.measureText(name).width
      ctx.fillStyle = 'rgba(16,18,34,.72)'
      ctx.beginPath(); ctx.roundRect(e.x - tw / 2 - 6, e.y + 8, tw + 12, 18, 5); ctx.fill()
      ctx.fillStyle = isPlayer ? '#ffd24a' : (e.color || '#fff')
      ctx.textAlign = 'center'; ctx.fillText(name, e.x, e.y + 21); ctx.textAlign = 'left'
    }
  }

  _drawBubble(e) {
    const { ctx } = this
    const set = this.images[e.sprite]
    const h = set && set.down ? set.down.height : 96
    let text = e.bubble.text
    if (text.length > 64) text = text.slice(0, 63) + '…'
    ctx.font = '14px "Segoe UI", sans-serif'
    const maxW = 230
    const lines = []
    let line = ''
    for (const ch of text) {
      if (ch === '\n' || ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch === '\n' ? '' : ch }
      else line += ch
      if (lines.length >= 3) break
    }
    if (line && lines.length < 3) lines.push(line)
    const w = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width))) + 18
    const bh = lines.length * 19 + 12
    let bx = e.x - w / 2, by = e.y - h - bh - 10
    bx = Math.max(6, Math.min(this.cv.width - w - 6, bx))
    by = Math.max(6, by)
    ctx.fillStyle = 'rgba(255,255,255,.96)'
    ctx.strokeStyle = 'rgba(30,32,55,.9)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.roundRect(bx, by, w, bh, 8); ctx.fill(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(e.x - 6, by + bh); ctx.lineTo(e.x + 6, by + bh); ctx.lineTo(e.x, by + bh + 8); ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.fill()
    ctx.fillStyle = '#1c2136'
    lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 20 + i * 19))
  }

  _drawCabinetScreens() {
    const { ctx } = this
    for (const c of this.maps.arcade.cabinets) {
      const info = this.cabinetLabels[c.id]
      const [sx, sy, ex, ey] = c.screen
      if (!info) {
        // idle attract mode
        ctx.fillStyle = `hsl(${(this.t / 20 + c.id * 47) % 360},70%,18%)`
        ctx.fillRect(sx, sy, ex - sx, ey - sy)
        ctx.fillStyle = `hsla(${(this.t / 8 + c.id * 90) % 360},90%,60%,.8)`
        const n = 4
        for (let i = 0; i < n; i++) {
          const px = sx + ((this.t / 30 + i * 17 + c.id * 7) % (ex - sx - 6))
          ctx.fillRect(px, sy + 4 + (i * 13) % (ey - sy - 10), 5, 5)
        }
      } else {
        ctx.fillStyle = '#10131f'; ctx.fillRect(sx, sy, ex - sx, ey - sy)
        ctx.fillStyle = info.color || '#ffd24a'
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'
        const cx = (sx + ex) / 2
        ctx.fillText(info.emoji || '🎮', cx, sy + (ey - sy) / 2 - 2)
        ctx.font = '9px monospace'
        ctx.fillText((info.title || '').slice(0, 8), cx, ey - 5)
        ctx.textAlign = 'left'
        // blink playing light
        if (info.playing && this.t % 900 < 550) {
          ctx.fillStyle = '#7de0a0'
          ctx.beginPath(); ctx.arc(ex + 6, sy - 4, 3, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    if (this.marquee) {
      ctx.font = 'bold 17px "Segoe UI", sans-serif'
      const msg = `NOW SHOWING: ${this.marquee.emoji} ${this.marquee.title}`
      const tw = ctx.measureText(msg).width
      const x = this.cv.width - ((this.t / 6) % (this.cv.width + tw))
      ctx.fillStyle = '#ffd24a'
      ctx.fillText(msg, x, 105)
    }
  }

  _drawShelfCartridges() {
    const { ctx } = this
    const sh = this.maps.office.shelf
    const games = this._shelfGames || []
    const [tx, ty] = [sh.tiles[0], sh.tiles[1]]
    games.slice(0, 10).forEach((g, i) => {
      const row = Math.floor(i / 5), col = i % 5
      const x = tx * T + 12 + col * 34, y = ty * T + 14 + row * 44
      ctx.fillStyle = g.color || '#b78cff'
      ctx.fillRect(x, y, 26, 22)
      ctx.fillStyle = 'rgba(255,255,255,.85)'
      ctx.fillRect(x + 4, y + 4, 18, 8)
      ctx.font = '10px monospace'; ctx.fillStyle = '#1c2136'
      ctx.fillText((g.emoji || '🎮'), x + 7, y + 12)
    })
  }
  setShelfGames(games) { this._shelfGames = games }
}
