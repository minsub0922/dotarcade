import React, { useRef, useEffect, useState } from 'react'
import { useStore } from '../state/store.js'
import Markdown from './Markdown.jsx'
import Radar from './Radar.jsx'
import { CRITERIA } from '../data/criteria.js'

const Star = ({ n }) => {
  if (!Number.isFinite(Number(n))) return <span className="stars muted">평가 제외</span>
  const filled = Math.max(1, Math.round(Number(n) / 2))
  return <span className="stars">{'★'.repeat(filled)}<i>{'★'.repeat(5 - filled)}</i></span>
}

const shortAction = action => String(action || '관찰 중')
  .replaceAll('Arrow', '').replaceAll('Space', 'SPACE').replaceAll('+', ' + ')

const statusLabel = status => ({
  queued: '대기', walking: '이동 중', playing: '플레이 중', played: '분석 중', done: '완료', invalid: '제외'
})[status] || status

const VenueBadge = ({ venue, label }) => (
  <span className={`venue-badge venue-${venue || 'cabinet'}`} title={`플레이 환경: ${label || (venue === 'handheld' ? '휴대 게임기' : '아케이드 캐비닛')}`}>
    {venue === 'handheld' ? '▣ POCKET' : '🕹 CABINET'}
  </span>
)

export default function ArcadePanel({ sim, onBack }) {
  const arcade = useStore(s => s.arcade)
  const closePanel = useStore(s => s.closePanel)
  const [open, setOpen] = useState(null)
  const feedRef = useRef(null)

  useEffect(() => { feedRef.current?.scrollTo(0, 1e9) }, [arcade?.reports?.length])

  if (!arcade) return null
  const running = arcade.status === 'running' || arcade.status === 'summarizing'
  const pct = Math.round((arcade.progress / 20) * 100)
  const elapsed = Math.floor((Date.now() - arcade.startedAt) / 1000)
  const liveAgents = Object.values(arcade.liveAgents || {})
  const activeAgents = liveAgents.filter(a => ['walking', 'playing', 'played'].includes(a.status))
  const leaderboard = [...liveAgents]
    .filter(a => Number.isFinite(Number(a.score)))
    .sort((a, b) => (Number(b.score) - Number(a.score)) || (Number(b.scoreRate) - Number(a.scoreRate)))
    .slice(0, 5)
  const highlights = [...(arcade.highlights || [])].reverse().slice(0, 5)

  return (
    <aside className="panel side wide">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <b>🕹️ 오락실 시뮬레이션</b> <span className="muted">{arcade.emoji} {arcade.title} {arcade.version}</span>
          <div className="progress-row">
            <div className="progress"><div style={{ width: pct + '%' }} /></div>
            <span className="tiny">{arcade.progress}/20명 · 유효 {arcade.validReports ?? 0}명 · {Math.floor(elapsed / 60)}분 {elapsed % 60}초</span>
            {arcade.avg != null && <span className="avg-badge">평균 {arcade.avg}/10</span>}
          </div>
        </div>
        <button className="x" onClick={closePanel} title="접기">▁</button>
      </div>

      <div className="feed" ref={feedRef}>
        {running && liveAgents.length > 0 && (
          <section className="agent-arena-live">
            <div className="agent-arena-head">
              <div><b>🤖 전략 에이전트 아레나</b><span className="tiny muted"> 같은 seed 묶음에서 5개 정책 비교</span></div>
              <span className="live-pill"><i />LIVE {activeAgents.length}</span>
            </div>

            <div className="live-leaderboard">
              <div className="live-section-title">🏆 실플레이 리더보드</div>
              {leaderboard.map((a, i) => (
                <div className={`leader-row ${i === 0 ? 'leader' : ''}`} key={a.id}>
                  <b className="leader-rank">{i + 1}</b>
                  <img src={`/assets/sprites_v2/${a.id}/face.png`} className="face xs" alt="" />
                  <span className="leader-name">{a.name}</span>
                  <span className="agent-badges"><VenueBadge venue={a.venue} label={a.venueLabel} /><span className={`strategy-badge strategy-${a.strategy?.key}`}>{a.strategy?.icon} {a.strategy?.label}</span></span>
                  <span className="leader-score"><b>{a.score || 0}</b>점 <small>{Number(a.scoreRate || 0).toFixed(1)}/초</small></span>
                </div>
              ))}
            </div>

            <div className="live-agent-grid">
              {activeAgents.slice(0, 6).map(a => (
                <article className={`live-agent-card status-${a.status}`} key={a.id}>
                  <div className="live-agent-title">
                    <span><b>{a.name}</b> <i>{statusLabel(a.status)}</i></span>
                    <span className="agent-badges"><VenueBadge venue={a.venue} label={a.venueLabel} /><span className={`strategy-badge strategy-${a.strategy?.key}`}>{a.strategy?.icon} {a.strategy?.label}</span></span>
                  </div>
                  <div className="live-agent-goal">목표 · {a.goal}</div>
                  <div className="live-agent-action"><b>{a.phase}</b><span>{shortAction(a.action)}</span></div>
                  {a.routePlan && <div className="live-agent-route"><span>{a.routePlan.planner === 'autonomous-goal-planner' ? '자율 플래너' : 'A* 안전 경로'}</span><b>재계획 {a.routePlan.replans || 0}/{a.routePlan.maxReplans ?? 1}</b></div>}
                  <div className="live-agent-stats"><span>점수 <b>{a.score || 0}</b></span><span>속도 <b>{Number(a.scoreRate || 0).toFixed(1)}</b>/초</span><span>탐색 <b>{a.uniqueActions || 0}</b>종</span></div>
                  {a.bestAction && <div className="live-agent-best">↗ 학습한 행동 {shortAction(a.bestAction)}</div>}
                </article>
              ))}
            </div>

            {highlights.length > 0 && (
              <div className="agent-highlights">
                <div className="live-section-title">⚡ 실시간 하이라이트</div>
                {highlights.map((h, i) => <div className="agent-highlight" key={`${h.at}-${i}`}><span>{h.strategy?.icon}</span><b>{h.name}</b><em>{h.text}</em></div>)}
              </div>
            )}
          </section>
        )}

        {arcade.missionResult && (
          <div className={`mission-result ${arcade.missionResult.success ? 'success' : 'failed'}`}>
            <b>{arcade.missionResult.success ? '🏅 빌드 미션 성공' : '🧪 빌드 미션 도전 완료'} — {arcade.missionResult.label}</b>
            <span>측정 {arcade.missionResult.value} / 목표 {arcade.missionResult.operator === 'gte' ? '≥' : '≤'} {arcade.missionResult.target}</span>
            <strong>+{arcade.missionResult.xp} XP{arcade.missionResult.coins ? ` · +${arcade.missionResult.coins} 코인` : ''}</strong>
          </div>
        )}

        {arcade.status === 'summarizing' && <div className="sys-line pulse-text">📊 종합 리포트 작성 중…</div>}
        {['done', 'report_error'].includes(arcade.status) && arcade.summary && (
          <div className="summary-card">
            {arcade.ratings && (
              <div className="summary-radar">
                <Radar ratings={arcade.ratings} size={150} color="#ffd24a" />
              </div>
            )}
            <Markdown className="md" text={arcade.summary} />
          </div>
        )}
        {[...arcade.reports].reverse().map((r, i) => (
          <div key={i} className={`report ${open === i ? 'open' : ''} ${r.evaluationFailed ? 'invalid' : ''}`} onClick={() => setOpen(open === i ? null : i)}>
            <div className="report-head">
              <img src={`/assets/sprites_v2/${r.visitor.id}/face.png`} className="face sm" alt="" />
              <div style={{ flex: 1 }}>
                <b>{r.visitor.name}</b> <span className="tiny muted">{r.visitor.age}세 · {r.visitor.job}</span>{' '}
                {r.telemetry?.strategy && <span className={`strategy-badge strategy-${r.telemetry.strategy.key}`}>{r.telemetry.strategy.icon} {r.telemetry.strategy.label}</span>} {' '}
                <VenueBadge venue={r.venue || r.telemetry?.venue} label={r.venueLabel || r.telemetry?.venueLabel} />
                <div className="one-liner">"{r.oneLiner}"</div>
              </div>
              <div className="score-box">{r.score == null ? <b>—</b> : <><b>{r.score}</b>/10</>}<Star n={r.score} /></div>
            </div>
            {open === i && (
              <div className="report-detail">
                {r.telemetry?.strategy && (
                  <div className="agent-evidence-summary">
                    <b>{r.telemetry.strategy.icon} 목표</b> {r.telemetry.strategy.goal}
                    <div className="telemetry-chips">
                      <span>환경 seed <b>{r.telemetry.seed}</b></span>
                      <span>점수 속도 <b>{Number(r.telemetry.scoreRate || 0).toFixed(2)}</b>/초</span>
                      <span>행동 탐색 <b>{r.telemetry.uniqueActions || 0}</b>종</span>
                      {r.telemetry.bestAction && <span>학습 행동 <b>{shortAction(r.telemetry.bestAction)}</b></span>}
                    </div>
                    {r.telemetry.highlights?.length > 0 && <div className="evidence-log">{r.telemetry.highlights.slice(-4).map((h, j) => <span key={j}>⚡ {h}</span>)}</div>}
                  </div>
                )}
                {r.routePlan && (
                  <div className="route-evidence">
                    <b>🧭 자율 이동 증거</b>
                    <span>{r.routePlan.planner === 'autonomous-goal-planner' ? '자율 목표 플래너' : 'A* 안전 경로'} · 목적지 [{r.routePlan.target?.join(', ')}] · 재계획 {r.routePlan.replans || 0}/{r.routePlan.maxReplans ?? 1} · {r.routePlan.arrived ? '도착' : '시간 상한 종료'}</span>
                    {(r.planEvidence || r.routePlan.evidence || []).map((line, j) => <small key={j}>{line}</small>)}
                  </div>
                )}
                {r.ratings && (
                  <div className="axis-chips">
                    {CRITERIA.map(c => r.ratings[c.key] != null && (
                      <span key={c.key} className="axis-chip" title={c.desc}>{c.label} <b>{r.ratings[c.key]}</b></span>
                    ))}
                  </div>
                )}
                <div>🎯 <b>재미</b> {r.detail.fun}</div>
                <div>📈 <b>난이도</b> {r.detail.difficulty}</div>
                <div>🎮 <b>조작</b> {r.detail.controls}</div>
                <div>🎨 <b>그래픽</b> {r.detail.graphics}</div>
                {r.bugs?.length > 0 && <div className="err">🐛 {r.bugs.join(' / ')}</div>}
                {r.suggestions?.length > 0 && <div>💡 {r.suggestions.join(' / ')}</div>}
                {r.evaluationFailed && <div className="err">⚠️ 평균에서 제외됨 — {r.error}</div>}
                <div className="tiny muted">실플레이: {Math.round((r.telemetry?.ms || 0) / 1000)}초 · 점수 {r.telemetry?.score} · 입력 {r.telemetry?.presses}회 · 행동별 {Object.entries(r.telemetry?.actionCounts || {}).map(([k, n]) => `${shortAction(k)} ${n}`).join(' / ') || '-'} {r.telemetry?.errors ? `· 오류 ${r.telemetry.errors}건` : ''}</div>
              </div>
            )}
          </div>
        ))}
        {running && arcade.reports.length === 0 && (
          <div className="sys-line">손님들이 자율 경로를 계획해 캐비닛 또는 휴대 게임기로 이동하고 있습니다…<br />두 환경 모두 같은 실제 AI 게임 런과 리더보드에 연결됩니다.</div>
        )}
      </div>

      <div className="panel-foot">
        {running && <button className="danger" onClick={() => { sim.cancel(); useStore.getState().setArcade({ status: 'cancelled' }) }}>시뮬레이션 중단</button>}
        {!running && (
          <>
            {arcade.summary && (
              <button className="accent" onClick={() => useStore.getState().setArcade({ reportSeen: false })}>📊 리포트 보기</button>
            )}
            <button onClick={onBack}>🏢 사무실로 돌아가기</button>
            <button onClick={() => useStore.getState().setArcade(null) || closePanel()}>닫기</button>
          </>
        )}
      </div>
    </aside>
  )
}
