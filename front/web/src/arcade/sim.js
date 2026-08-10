// DOTCADE — 오락실 시뮬레이션: 20 손님 에이전트 병렬 피드백 파이프라인
import { api } from '../api.js'
import { VISITORS } from '../data/personas.js'
import { visitorSystem, visitorFeedbackPrompt, FEEDBACK_SCHEMA } from '../meeting/prompts.js'
import { mountGame } from '../game/harness.js'
import { useStore } from '../state/store.js'

const S = () => useStore.getState()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const MAX_SIM_MS = 10 * 60 * 1000   // 10분 상한

export class ArcadeSim {
  constructor(world) {
    this.world = world
    this.cancelled = false
    this.activeSims = new Map()   // visitorId -> dispose fn
  }

  cancel() {
    this.cancelled = true
    for (const dispose of this.activeSims.values()) { try { dispose() } catch {} }
    this.activeSims.clear()
  }

  // 봇 플레이 1회 (숨김/미니 뷰 iframe) → 텔레메트리
  _botPlay(code, visitor, slotEl) {
    return new Promise(resolve => {
      const t = { score: 0, ms: 0, presses: 0, errors: 0, overFired: false, ready: false, fatal: null }
      const dur = Math.min(20000, visitor.patience + 2000)
      const game = mountGame(slotEl, code, {
        mode: 'bot',
        seed: 1000 + VISITORS.indexOf(visitor) * 77,
        bot: {
          aggression: visitor.aggr,
          intervalMs: 90 + (1 - visitor.aggr) * 160,
          holdMs: 120 + (1 - visitor.aggr) * 120,
          durationMs: visitor.patience
        }
      })
      this.activeSims.set(visitor.id, () => { game.dispose(); resolve(t) })
      const kill = setTimeout(() => { finish() }, dur + 3500)
      const finish = () => {
        clearTimeout(kill)
        this.activeSims.delete(visitor.id)
        game.dispose()
        resolve(t)
      }
      game.on(m => {
        if (m.type === 'ready') t.ready = true
        if (m.type === 'fatal') { t.fatal = m.message; finish() }
        if (m.type === 'error') t.errors++
        if (m.type === 'score') t.score = m.score
        if (m.type === 'over' || m.type === 'timeout') {
          t.overFired = m.type === 'over'
          t.score = m.score ?? t.score; t.ms = m.ms || 0; t.presses = m.presses || 0
          finish()
        }
      })
    })
  }

  async run(game) {
    const w = this.world
    this.cancelled = false
    const startedAt = Date.now()
    const version = game.version

    S().setArcade({
      gameId: game.id, title: game.title, emoji: game.emoji, version,
      status: 'running', startedAt, reports: [], progress: 0, summary: null, playing: []
    })

    // ---- 게임 번들 & 기획 요약 로드 ----
    const [bundle, filesRes] = await Promise.all([
      api.bundle(game.id),
      api.files(game.id).catch(() => ({ files: {} }))
    ])
    const code = bundle.code || ''
    const prd = filesRes.files?.['docs/prd.md'] || ''
    const prdSummary = prd.slice(0, 900)
    const codeExcerpt = code.length > 3500 ? code.slice(0, 3500) + `\n// ... (총 ${code.split('\n').length}줄)` : code

    // ---- 오락실 연출 준비 ----
    const cabs = w.maps.arcade.cabinets
    cabs.forEach(c => { w.cabinetLabels[c.id] = { title: game.title, emoji: game.emoji, color: game.color, playing: false } })
    w.marquee = { title: game.title, emoji: game.emoji }
    w.simMode = true

    // 손님 입장 (스태거)
    const door = w.maps.arcade.spawn
    VISITORS.forEach((v, i) => {
      setTimeout(() => {
        if (this.cancelled) return
        if (!w.agent(v.id)) w.addAgent(v.id, v.id, door, { label: `${v.name}(${v.age})`, color: '#c9d1ff', map: 'arcade' })
        const idle = this._idleSpot()
        w.goTo(v.id, idle)
      }, i * 420)
    })

    // ---- 병렬 파이프라인 ----
    const conc = Math.max(1, Math.min(6, S().settings.simConcurrency || 3))
    const queue = [...VISITORS]
    const reports = []
    const freeCabs = cabs.map(c => c.id)
    const self = this

    const runOne = async v => {
      if (self.cancelled || Date.now() - startedAt > MAX_SIM_MS) return
      // 캐비닛 배정 + 이동 연출
      const cabId = freeCabs.length ? freeCabs.shift() : null
      const cab = cabs.find(c => c.id === cabId) || cabs[Math.floor(Math.random() * cabs.length)]
      await new Promise(res => {
        w.goTo(v.id, cab.spot, res)
        setTimeout(res, 4500) // 경로 실패 안전장치
      })
      if (self.cancelled) return
      w.face(v.id, cab.facing === 'down' ? 'up' : 'right')
      if (w.cabinetLabels[cab.id]) w.cabinetLabels[cab.id].playing = true
      w.bubble(v.id, '🕹️ 플레이 시작!', 2500)
      S().setArcade({ playing: [...(S().arcade?.playing || []), v.id] })

      // 실제 봇 플레이 (미니 라이브 뷰 슬롯)
      const slot = document.getElementById(`sim-slot-${v.id}`) || document.getElementById('sim-slot-pool')
      let telemetry = { score: 0, ms: 0, presses: 0, errors: 0, overFired: false }
      if (slot && code) telemetry = await this._botPlay(code, v, slot)
      if (self.cancelled) return

      // 중간 리액션
      w.bubble(v.id, telemetry.errors > 0 ? '어? 뭔가 이상한데' : telemetry.overFired ? `으악, ${telemetry.score}점...` : `${telemetry.score}점!`, 3000)

      // 페르소나 LLM 피드백
      let fb = null
      try {
        const out = await api.generate({
          system: visitorSystem(v),
          messages: [{ role: 'user', text: visitorFeedbackPrompt({ ...game, version }, prdSummary, codeExcerpt, telemetry) }],
          hint: 'feedback', model: 'fast', json: FEEDBACK_SCHEMA,
          personaMeta: { name: v.name, strict: v.strict }
        })
        fb = JSON.parse(out.text.replace(/```json|```/g, '').trim())
      } catch (e) {
        fb = { score: 5, oneLiner: '(피드백 수집 실패)', detail: { fun: '', difficulty: '', controls: '', graphics: '' }, bugs: [], suggestions: [], error: String(e.message || e) }
      }
      const report = { visitor: { id: v.id, name: v.name, age: v.age, job: v.job }, telemetry, ...fb, at: Date.now() }
      reports.push(report)
      S().pushReport(report)
      S().setArcade({ progress: reports.length, playing: (S().arcade?.playing || []).filter(x => x !== v.id) })

      // 연출: 한줄평 말풍선 + 자리 비켜주기
      w.bubble(v.id, `${'★'.repeat(Math.max(1, Math.round(fb.score / 2)))} ${fb.oneLiner}`.slice(0, 60), 5200)
      if (w.cabinetLabels[cab.id]) w.cabinetLabels[cab.id].playing = false
      if (cabId != null) freeCabs.push(cabId)
      setTimeout(() => { if (!self.cancelled && w.agent(v.id)) w.goTo(v.id, this._idleSpot()) }, 1800)
    }

    const workers = Array.from({ length: conc }, async () => {
      while (queue.length && !this.cancelled && Date.now() - startedAt < MAX_SIM_MS) {
        const v = queue.shift()
        try { await runOne(v) } catch (e) { console.error('sim error', v.id, e) }
        await sleep(200)
      }
    })
    await Promise.all(workers)
    if (this.cancelled) { this._cleanup(); return null }

    // ---- 종합 리포트 ----
    const avg = reports.length ? +(reports.reduce((s, r) => s + (r.score || 0), 0) / reports.length).toFixed(1) : 0
    S().setArcade({ status: 'summarizing' })
    let summary = ''
    try {
      const digest = reports.map(r =>
        `${r.visitor.name}(${r.visitor.age}, ${r.visitor.job}) ${r.score}점: ${r.oneLiner} / 재미:${r.detail.fun} 난이도:${r.detail.difficulty} 조작:${r.detail.controls} 그래픽:${r.detail.graphics}${r.bugs?.length ? ' 버그:' + r.bugs.join(';') : ''} 제안:${(r.suggestions || []).join(';')}`
      ).join('\n')
      const out = await api.generate({
        system: '당신은 DOTCADE 오락실의 운영 분석가입니다. 한국어로 간결하고 실행 가능한 리포트를 씁니다.',
        messages: [{
          role: 'user', text: `게임 「${game.title}」 ${version}의 오락실 손님 ${reports.length}명 피드백입니다:\n\n${digest.slice(0, 9000)}\n\n평균 점수: ${avg}/10\n\n마크다운 종합 리포트를 작성하세요:\n# 오락실 반응 리포트 — ${game.title} ${version}\n**총평** (2문장)\n## 강점 (불릿 2~3)\n## 약점 (불릿 2~3)\n## 연령대별 반응 (10대/2030/4050 한 줄씩)\n## 다음 버전 우선순위 (번호 1~3, 구체적으로)`
        }],
        hint: 'summary', model: 'smart'
      })
      summary = out.text
    } catch (e) { summary = `(요약 생성 실패: ${e.message})` }

    await api.saveFeedback(game.id, { version, reports, summary, avg }).catch(() => {})
    api.ragUpsert([{
      id: `fb-${game.id}-${version}`, kind: 'feedback', gameId: game.id,
      text: `${game.title} ${version} 오락실 반응(평균 ${avg}/10): ${summary.slice(0, 1500)}`
    }])
    const gl = await api.games(); S().setGames(gl.games); w.setShelfGames(gl.games)
    S().setArcade({ status: 'done', summary, avg, endedAt: Date.now() })
    S().toast(`🏁 오락실 시뮬레이션 완료 — 평균 ${avg}/10 (${reports.length}명)`, 'success')
    return { avg, reports, summary }
  }

  _idleSpot() {
    const zones = [[11, 6, 18, 9], [10, 13, 20, 15], [8, 6, 24, 15]]
    const z = zones[Math.floor(Math.random() * zones.length)]
    const g = this.world.maps.arcade.collision
    for (let i = 0; i < 40; i++) {
      const x = z[0] + Math.floor(Math.random() * (z[2] - z[0] + 1))
      const y = z[1] + Math.floor(Math.random() * (z[3] - z[1] + 1))
      if (g[y] && g[y][x] === '.') return [x, y]
    }
    return this.world.maps.arcade.spawn
  }

  _cleanup() {
    const w = this.world
    w.simMode = false
    w.marquee = null
  }
}
