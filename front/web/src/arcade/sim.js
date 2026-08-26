// DOTCADE — 오락실 시뮬레이션: 20 손님 에이전트 병렬 피드백 파이프라인
import { api } from '../api.js'
import { VISITORS, strategyFor } from '../data/personas.js'
import { CRITERIA, sanitizeRatings, avgRatings } from '../data/criteria.js'
import { visitorSystem, visitorFeedbackPrompt, FEEDBACK_SCHEMA } from '../meeting/prompts.js'
import { mountGame } from '../game/harness.js'
import { useStore } from '../state/store.js'
import {
  PORTABLE_SPOTS, portableVenueFor, routeAgentBounded, setAgentHandheld, venueLabel
} from './portable.js'
import { evaluationCodeExcerpt } from './codeExcerpt.js'
import { ensureArcadeSummary, mergeSavedFeedback, saveFeedbackWithRetry } from './report.js'

const S = () => useStore.getState()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const MAX_SIM_MS = 10 * 60 * 1000   // 10분 상한
const ENV_SEED_BASE = 73013

const evaluationFailure = message => ({
  // undefined는 JSON 저장 시 생략된다. 백엔드 누적 통계의 Number(null) === 0 오염도 방지한다.
  score: undefined, oneLiner: '(평가 제외)', ratings: null,
  detail: { fun: '', difficulty: '', controls: '', graphics: '' },
  bugs: [], suggestions: [], evaluationFailed: true, error: String(message || '평가 실패')
})

const numericScore = value => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : null
}

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
    for (const visitor of VISITORS) {
      setAgentHandheld(this.world, visitor.id, null)
      const entity = this.world?.agent?.(visitor.id)
      if (entity?.meta?.plan) entity.meta.plan = { ...entity.meta.plan, status: 'cancelled', endedAt: Date.now() }
    }
    for (const label of Object.values(this.world?.cabinetLabels || {})) label.playing = false
    S().setArcade({ playing: [] })
  }

  // 봇 플레이 1회 (숨김/미니 뷰 iframe) → 텔레메트리
  _botPlay(code, visitor, slotEl, onLive) {
    return new Promise(resolve => {
      const visitorIndex = Math.max(0, VISITORS.indexOf(visitor))
      const cohort = Math.floor(visitorIndex / 5)
      const seed = ENV_SEED_BASE + cohort * 7919 // 한 cohort의 다섯 전략은 동일 환경 seed
      const botSeed = 91009 + visitorIndex * 104729
      const strategy = strategyFor(visitor)
      const t = {
        score: 0, ms: 0, presses: 0, errors: 0, overFired: false, ready: false, fatal: null,
        valid: false, strategy, seed, botSeed, scoreTimeline: [], actionCounts: {}, scoreRate: 0,
        evidence: [], highlights: [], events: [], currentAction: '입장 중', phase: '준비'
      }
      const dur = Math.min(20000, visitor.patience + 2000)
      const game = mountGame(slotEl, code, {
        mode: 'bot',
        seed,
        botSeed,
        bot: {
          strategy,
          aggression: visitor.aggr,
          intervalMs: 90 + (1 - visitor.aggr) * 160,
          holdMs: 120 + (1 - visitor.aggr) * 120,
          durationMs: visitor.patience
        }
      })
      let done = false
      let kill = null
      const finish = (reason, payload = null) => {
        if (done) return
        done = true
        clearTimeout(kill)
        if (payload) {
          for (const key of [
            'score', 'ms', 'presses', 'strategy', 'seed', 'botSeed', 'phase', 'currentAction', 'bestAction',
            'scoreTimeline', 'actionCounts', 'scoreRate', 'uniqueActions', 'events', 'observations',
            'observationCount', 'evidence', 'highlights', 'finishReason'
          ]) if (payload[key] != null) t[key] = payload[key]
        }
        t.valid = t.ready && !t.fatal && (reason === 'over' || reason === 'timeout') && t.ms > 0
        if (!t.valid) t.invalidReason = t.fatal || (reason === 'watchdog' ? '게임 종료 신호 없음' : reason)
        this.activeSims.delete(visitor.id)
        game.dispose()
        onLive?.({
          status: t.valid ? 'played' : 'invalid', score: t.score, scoreRate: t.scoreRate,
          action: t.currentAction, phase: t.phase, bestAction: t.bestAction,
          highlight: t.valid ? `${t.score}점 · ${t.scoreRate}/초` : `평가 제외: ${t.invalidReason}`
        })
        resolve(t)
      }
      this.activeSims.set(visitor.id, () => finish('cancelled'))
      kill = setTimeout(() => finish('watchdog'), dur + 3500)
      game.on(m => {
        if (m.type === 'ready') {
          t.ready = true
          onLive?.({ status: 'playing', action: '게임 규칙 스캔', phase: '준비', seed })
        }
        if (m.type === 'fatal') { t.fatal = m.message; finish('fatal', m) }
        if (m.type === 'error') { t.errors++; onLive?.({ highlight: `런타임 오류: ${m.message}` }) }
        if (m.type === 'score') t.score = m.score
        if (m.type === 'agent-state') {
          Object.assign(t, {
            score: m.score ?? t.score, scoreRate: m.scoreRate ?? t.scoreRate, phase: m.phase || t.phase,
            currentAction: m.action || t.currentAction, bestAction: m.bestAction || t.bestAction,
            actionCounts: m.actionCounts || t.actionCounts, uniqueActions: m.uniqueActions ?? t.uniqueActions
          })
          onLive?.({
            status: 'playing', score: t.score, scoreRate: t.scoreRate, action: t.currentAction,
            phase: t.phase, bestAction: t.bestAction, actionCounts: t.actionCounts,
            uniqueActions: t.uniqueActions, highlight: m.highlight || ''
          })
        }
        if (m.type === 'agent-event' && m.event) {
          t.evidence = [...t.evidence, m.event].slice(-28)
          onLive?.({ highlight: m.event.label, lastEvent: m.event })
        }
        if (m.type === 'game-event' && m.event) t.events = [...t.events, m.event].slice(-36)
        if (m.type === 'over' || m.type === 'timeout') {
          t.overFired = m.type === 'over'
          t.errors = m.errors ?? t.errors
          finish(m.type, m)
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
      status: 'running', startedAt, reports: [], progress: 0, summary: null, playing: [],
      summaryStream: '', reportSeen: false, liveAgents: {}, highlights: [], validReports: 0,
      missionResult: null
    })

    // ---- 게임 번들 & 기획 요약 로드 ----
    const [bundle, filesRes] = await Promise.all([
      api.bundle(game.id),
      api.files(game.id).catch(() => ({ files: {} }))
    ])
    const code = bundle.code || ''
    const prd = filesRes.files?.['docs/prd.md'] || ''
    const prdSummary = prd.slice(0, 900)
    const codeExcerpt = evaluationCodeExcerpt(code)

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
    const reportedVisitors = new Set()
    const freeCabs = cabs.map(c => c.id)
    const freeHandheldSpots = PORTABLE_SPOTS.arcade.map(tile => [...tile])
    const releaseVisitor = new Map()
    const self = this

    const updateLive = (v, patch) => {
      const arcade = S().arcade
      if (!arcade || arcade.gameId !== game.id) return
      const strategy = strategyFor(v)
      const prev = arcade.liveAgents?.[v.id] || {
        id: v.id, name: v.name, age: v.age, strategy, status: 'queued', score: 0, scoreRate: 0,
        goal: strategy.goal, action: '플레이 장소 선택', phase: '자율 계획'
      }
      const next = { ...prev, ...patch, strategy, goal: strategy.goal, updatedAt: Date.now() }
      const highlights = patch.highlight
        ? [...(arcade.highlights || []), { visitorId: v.id, name: v.name, strategy, text: patch.highlight, at: Date.now() }].slice(-12)
        : (arcade.highlights || [])
      S().setArcade({ liveAgents: { ...(arcade.liveAgents || {}), [v.id]: next }, highlights })
    }

    const recordReport = report => {
      const visitorId = report?.visitor?.id
      if (!visitorId || reportedVisitors.has(visitorId)) return false
      reportedVisitors.add(visitorId)
      reports.push(report)
      S().pushReport(report)
      const validReports = reports.filter(r => Number.isFinite(r.score) && !r.evaluationFailed).length
      S().setArcade({ progress: reports.length, validReports })
      return true
    }

    const runOne = async v => {
      if (self.cancelled || Date.now() - startedAt > MAX_SIM_MS) return
      const visitorIndex = Math.max(0, VISITORS.indexOf(v))
      const venue = portableVenueFor(v, visitorIndex)
      let cabId = null
      let cab = null
      let handheldSpot = null
      if (venue === 'cabinet') {
        cabId = freeCabs.length ? freeCabs.shift() : null
        cab = cabs.find(c => c.id === cabId) || cabs[visitorIndex % cabs.length]
      } else {
        handheldSpot = freeHandheldSpots.length
          ? freeHandheldSpots.shift()
          : [...PORTABLE_SPOTS.arcade[visitorIndex % PORTABLE_SPOTS.arcade.length]]
      }
      const target = venue === 'handheld' ? handheldSpot : cab.spot
      const label = venueLabel(venue)
      let released = false
      releaseVisitor.set(v.id, () => {
        if (released) return
        released = true
        setAgentHandheld(w, v.id, null)
        if (cab && w.cabinetLabels[cab.id]) w.cabinetLabels[cab.id].playing = false
        if (cabId != null && !freeCabs.includes(cabId)) freeCabs.push(cabId)
        if (handheldSpot && !freeHandheldSpots.includes(handheldSpot)) freeHandheldSpots.push(handheldSpot)
        const current = S().arcade
        if (current) S().setArcade({ playing: (current.playing || []).filter(id => id !== v.id) })
      })

      // 입장 스태거보다 작업 큐가 먼저 도착해도 경로가 유실되지 않게 즉시 보장한다.
      if (!w.agent(v.id)) {
        w.addAgent(v.id, v.id, door, { label: `${v.name}(${v.age})`, color: '#c9d1ff', map: 'arcade' })
      }
      w.configureAutonomy?.(v.id, { profiles: ['visitor', v.strategy] })
      const entity = w.agent(v.id)
      entity.meta ||= {}
      entity.meta.plan = {
        kind: 'play-game', venue, target: [...target], gameId: game.id,
        status: 'routing', maxReplans: 1
      }
      updateLive(v, {
        status: 'walking', venue, venueLabel: label,
        action: `${label}로 이동`, phase: '자율 경로 계획',
        routePlan: entity.meta.plan,
        highlight: `${label} 선택 · 충돌 회피 경로 계산`
      })

      const routePlan = await routeAgentBounded(w, v.id, target, {
        kind: 'play-game', venue, gameId: game.id, title: game.title,
        timeoutMs: 7200, maxReplans: 1, allowDuringSim: true
      })
      entity.meta.plan = routePlan
      updateLive(v, {
        routePlan,
        planEvidence: routePlan.evidence,
        action: routePlan.arrived ? `${label} 도착` : `${label} 근처에서 플레이 전환`,
        phase: routePlan.arrived ? '목표 도착' : '경로 상한 종료'
      })
      if (self.cancelled) {
        return
      }

      if (venue === 'handheld') {
        w.face(v.id, 'down')
        setAgentHandheld(w, v.id, {
          state: 'playing', gameId: game.id, title: game.title, since: Date.now(),
          plannerGoalId: routePlan.plannerGoalId || null
        })
      } else {
        w.face(v.id, cab.facing === 'down' ? 'up' : 'right')
        if (w.cabinetLabels[cab.id]) w.cabinetLabels[cab.id].playing = true
      }
      const strategy = strategyFor(v)
      w.bubble(v.id, `${venue === 'handheld' ? '▣' : '🕹️'} ${strategy.ko} 플레이 시작!`, 2500)
      S().setArcade({ playing: [...(S().arcade?.playing || []), v.id] })
      updateLive(v, {
        status: 'playing', venue, venueLabel: label,
        action: `${label} 게임 부팅`, phase: '준비',
        routePlan, planEvidence: routePlan.evidence,
        highlight: `${strategy.label} 정책 투입 · ${label}`
      })

      // 실제 봇 플레이 (라이브 뷰 슬롯 — React가 이름표 슬롯을 그릴 시간을 준다)
      await sleep(120)
      const slot = document.getElementById(`sim-slot-${v.id}`) || document.getElementById('sim-slot-pool')
      let telemetry = {
        score: 0, ms: 0, presses: 0, errors: 0, overFired: false, ready: false, valid: false,
        strategy, scoreTimeline: [], actionCounts: {}, scoreRate: 0, evidence: [], events: []
      }
      if (slot && code) telemetry = await this._botPlay(code, v, slot, patch => updateLive(v, patch))
      else telemetry.invalidReason = code ? '라이브 플레이 슬롯 없음' : '게임 번들 없음'
      telemetry.venue = venue
      telemetry.venueLabel = label
      telemetry.routePlan = routePlan
      telemetry.planEvidence = routePlan.evidence
      if (self.cancelled) return

      // 중간 리액션
      w.bubble(v.id, telemetry.errors > 0 ? '어? 뭔가 이상한데' : telemetry.overFired ? `으악, ${telemetry.score}점...` : `${telemetry.score}점!`, 3000)

      // 페르소나 LLM 피드백
      let fb = null
      if (!telemetry.valid) {
        fb = evaluationFailure(telemetry.invalidReason || telemetry.fatal || '유효한 플레이 기록 없음')
      } else {
        try {
          const out = await api.generate({
            system: visitorSystem(v),
            messages: [{ role: 'user', text: visitorFeedbackPrompt({ ...game, version }, prdSummary, codeExcerpt, telemetry) }],
            hint: 'feedback', model: 'fast', json: FEEDBACK_SCHEMA,
            personaMeta: { name: v.name, strict: v.strict }
          })
          fb = JSON.parse(out.text.replace(/```json|```/g, '').trim())
          fb.score = numericScore(fb.score)
          if (fb.score == null) throw new Error('평가 점수 누락')
          fb.ratings = sanitizeRatings(fb.ratings)
          fb.detail = { fun: '', difficulty: '', controls: '', graphics: '', ...(fb.detail || {}) }
          fb.bugs = Array.isArray(fb.bugs) ? fb.bugs : []
          fb.suggestions = Array.isArray(fb.suggestions) ? fb.suggestions : []
        } catch (e) {
          fb = evaluationFailure(e.message || e)
        }
      }
      const report = {
        visitor: { id: v.id, name: v.name, age: v.age, job: v.job, strategy: v.strategy },
        venue, venueLabel: label, routePlan, planEvidence: routePlan.evidence,
        telemetry, ...fb, at: Date.now()
      }
      recordReport(report)
      S().setArcade({ playing: (S().arcade?.playing || []).filter(x => x !== v.id) })
      updateLive(v, {
        status: fb.evaluationFailed ? 'invalid' : 'done', evaluationScore: fb.score,
        venue, venueLabel: label, routePlan, planEvidence: routePlan.evidence,
        highlight: fb.evaluationFailed ? `평가 제외 · ${fb.error}` : `평가 ${fb.score}/10 · ${fb.oneLiner}`
      })

      // 연출: 한줄평 말풍선 + 자리 비켜주기
      w.bubble(v.id, fb.score == null
        ? `⚠️ 평가 제외: ${fb.error}`.slice(0, 60)
        : `${'★'.repeat(Math.max(1, Math.round(fb.score / 2)))} ${fb.oneLiner}`.slice(0, 60), 5200)
      releaseVisitor.get(v.id)?.()
      entity.meta.plan = { ...routePlan, status: 'complete', completedAt: Date.now() }
      setTimeout(() => { if (!self.cancelled && w.agent(v.id)) w.goTo(v.id, this._idleSpot()) }, 1800)
    }

    const workers = Array.from({ length: conc }, async () => {
      while (queue.length && !this.cancelled && Date.now() - startedAt < MAX_SIM_MS) {
        const v = queue.shift()
        try { await runOne(v) } catch (e) {
          console.error('sim error', v.id, e)
          if (!self.cancelled && !reportedVisitors.has(v.id)) {
            const failed = evaluationFailure(e.message || e)
            const entity = w.agent(v.id)
            const routePlan = entity?.meta?.plan || null
            recordReport({
              visitor: { id: v.id, name: v.name, age: v.age, job: v.job, strategy: v.strategy },
              venue: routePlan?.venue || null, venueLabel: routePlan?.venue ? venueLabel(routePlan.venue) : '플레이 준비',
              routePlan, planEvidence: routePlan?.evidence || [],
              telemetry: { score: 0, ms: 0, presses: 0, errors: 1, valid: false, invalidReason: String(e.message || e) },
              ...failed, at: Date.now()
            })
            updateLive(v, { status: 'invalid', highlight: `평가 제외 · ${failed.error}` })
          }
        }
        finally { releaseVisitor.get(v.id)?.(); releaseVisitor.delete(v.id) }
        await sleep(200)
      }
    })
    await Promise.all(workers)
    if (this.cancelled) { this._cleanup(); return null }
    // 시간 상한에 걸린 대기 손님도 누락시키지 않는다. 완료 리포트의 분모는 항상 20명이다.
    while (queue.length) {
      const v = queue.shift()
      const failed = evaluationFailure('전체 시뮬레이션 시간 상한으로 플레이를 시작하지 못함')
      recordReport({
        visitor: { id: v.id, name: v.name, age: v.age, job: v.job, strategy: v.strategy },
        venue: null, venueLabel: '대기열', routePlan: null, planEvidence: [],
        telemetry: { score: 0, ms: 0, presses: 0, errors: 0, valid: false, invalidReason: failed.error },
        ...failed, at: Date.now()
      })
      updateLive(v, { status: 'invalid', highlight: `평가 제외 · ${failed.error}` })
    }

    // ---- 종합 리포트 ----
    const validReports = reports.filter(r => Number.isFinite(r.score) && !r.evaluationFailed)
    const avg = validReports.length
      ? +(validReports.reduce((s, r) => s + r.score, 0) / validReports.length).toFixed(1)
      : null
    const runRatings = avgRatings(validReports.map(r => r.ratings).filter(Boolean))   // 이번 시뮬의 6축 평균
    const missionResult = this._settleMission(game, reports, runRatings)
    w.simMode = false
    VISITORS.forEach(v => { const a = w.agent(v.id); if (a) a.meta.ambientArcade = true })   // 손님들은 남아서 배회
    S().setArcade({ status: 'summarizing', avg, ratings: runRatings, summaryStream: '', validReports: validReports.length, missionResult })
    let summary = ''
    let summaryError = ''
    try {
      const digest = reports.map(r =>
        `${r.visitor.name}(${strategyFor(r.visitor).label}, ${r.venueLabel || venueLabel(r.venue)}) ${r.score == null ? '평가 제외' : `${r.score}점`}${r.ratings ? ` [${CRITERIA.map(c => `${c.label}${r.ratings[c.key] ?? '-'}`).join(' ')}]` : ''}: ${r.oneLiner} / 실플레이:${r.telemetry.score}점 ${r.telemetry.scoreRate || 0}점/초 입력:${r.telemetry.presses} / 이동:${r.routePlan?.planner || '-'} 재계획:${r.routePlan?.replans || 0} 도착:${r.routePlan?.arrived ? '성공' : '상한종료'} / 재미:${r.detail.fun} 난이도:${r.detail.difficulty} 조작:${r.detail.controls} 그래픽:${r.detail.graphics}${r.bugs?.length ? ' 버그:' + r.bugs.join(';') : ''} 제안:${(r.suggestions || []).join(';')}`
      ).join('\n')
      const axisLine = runRatings
        ? `\n6개 기준 평균: ${CRITERIA.map(c => `${c.label} ${runRatings[c.key] ?? '-'}`).join(' · ')}`
        : ''
      // 스트리밍 생성 — 리포트 팝업에 실시간 표시
      const out = await api.stream({
        system: '당신은 DOTCADE 오락실의 운영 분석가입니다. 한국어로 간결하고 실행 가능한 리포트를 씁니다.',
        messages: [{
          role: 'user', text: `게임 「${game.title}」 ${version}의 오락실 손님 ${reports.length}명 중 유효 평가 ${validReports.length}명의 피드백입니다:\n\n${digest.slice(0, 9000)}\n\n유효 평가 평균: ${avg == null ? '없음' : `${avg}/10`}${axisLine}\n\n마크다운 종합 리포트를 작성하세요:\n# 오락실 반응 리포트 — ${game.title} ${version}\n**총평** (2문장)\n## 평가 기준 분석 (6개 기준 평균을 근거로 가장 강한 축 1~2개와 가장 약한 축 1~2개를 해석)\n## 전략별 플레이 관찰 (Explorer/Score Hunter/Survivor/Bug Breaker/Learner 차이를 객관 텔레메트리 근거로 요약)\n## 강점 (불릿 2~3)\n## 약점 (불릿 2~3)\n## 다음 버전 우선순위 (번호 1~3, 약한 평가 축 개선을 반영해 구체적으로)`
        }],
        hint: 'summary', model: 'smart'
      }, delta => {
        S().setArcade({ summaryStream: (S().arcade?.summaryStream || '') + delta })
      })
      summary = ensureArcadeSummary({
        text: out.text || S().arcade?.summaryStream, game, version, reports, avg, ratings: runRatings
      })
    } catch (e) {
      summaryError = String(e.message || e)
      summary = ensureArcadeSummary({ game, version, reports, avg, ratings: runRatings, error: summaryError })
    }

    // 먼저 화면에 완성된 본문을 고정한다. 저장/목록 갱신이 느려도 리포트가 비어 보이지 않는다.
    S().setArcade({ summary, summaryStream: summary, summaryFallback: !!summaryError })
    const feedback = { runId: `${game.id}:${version}:${startedAt}`, version, reports, summary, avg, ratings: runRatings }
    let saved
    try {
      saved = await saveFeedbackWithRetry(
        payload => api.saveFeedback(game.id, payload),
        feedback,
        { attempts: 2, wait: () => sleep(350) }
      )
    } catch (e) {
      const feedbackError = String(e.message || e)
      S().setArcade({ status: 'report_error', summary, endedAt: Date.now(), feedbackError })
      S().toast(`피드백 저장 실패 — 리포트는 보존했습니다: ${feedbackError}`, 'warn')
      return { avg, reports, summary, persisted: false, error: feedbackError }
    }

    const savedFeedback = saved.feedback || { ...feedback, at: new Date().toISOString() }
    S().setGames(mergeSavedFeedback(S().games, game.id, version, savedFeedback, saved.stats))
    api.ragUpsert([{
      id: `fb-${game.id}-${version}`, kind: 'feedback', gameId: game.id,
      text: `${game.title} ${version} 오락실 반응(유효 ${validReports.length}명, 평균 ${avg ?? '-'}/10): ${summary.slice(0, 1500)}`
    }])
    try {
      const gl = await api.games()
      S().setGames(gl.games)
      w.setShelfGames(gl.games)
    } catch (e) {
      console.warn('saved feedback list refresh failed', e)
      w.setShelfGames(S().games)
    }
    S().setArcade({ status: 'done', summary, avg, endedAt: Date.now() })
    S().toast(`🏁 오락실 시뮬레이션 완료 — ${avg == null ? '유효 평가 없음' : `평균 ${avg}/10`} (${validReports.length}/${reports.length}명 유효)`, avg == null ? 'warn' : 'success')
    return { avg, reports, summary }
  }

  _settleMission(game, reports, ratings) {
    const st = S()
    const mission = st.studio?.activeMission
    if (!mission || mission.status !== 'active' || mission.gameId !== game.id || mission.version !== game.version) return null
    const telemetryErrors = reports.reduce((sum, r) => sum + (Number(r.telemetry?.errors) || 0) + (r.telemetry?.fatal ? 1 : 0), 0)
    const values = { errors: telemetryErrors, controls: Number(ratings?.controls) || 0, originality: Number(ratings?.originality) || 0 }
    const value = values[mission.metric] ?? 0
    const success = mission.operator === 'gte' ? value >= mission.target : value <= mission.target
    const payout = success ? (mission.reward || {}) : { xp: 8, coins: 0 }
    const reward = st.awardStudio?.({
      xp: payout.xp || 0, coins: payout.coins || 0,
      reason: success ? `미션 성공 · ${mission.label}` : `미션 도전 · ${mission.label}`,
      success, missionId: mission.id
    })
    if (!reward) return null
    return {
      missionId: mission.id, label: mission.label, metric: mission.metric, operator: mission.operator,
      target: mission.target, value, success, xp: reward.xp, coins: reward.coins
    }
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
    VISITORS.forEach(v => setAgentHandheld(w, v.id, null))
    Object.values(w.cabinetLabels || {}).forEach(label => { label.playing = false })
  }
}
