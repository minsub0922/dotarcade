import React, { useRef, useEffect, useState } from 'react'
import { useStore } from '../state/store.js'

const Star = ({ n }) => <span className="stars">{'★'.repeat(Math.max(1, Math.round(n / 2)))}<i>{'★'.repeat(5 - Math.max(1, Math.round(n / 2)))}</i></span>

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

  return (
    <aside className="panel side wide">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <b>🕹️ 오락실 시뮬레이션</b> <span className="muted">{arcade.emoji} {arcade.title} {arcade.version}</span>
          <div className="progress-row">
            <div className="progress"><div style={{ width: pct + '%' }} /></div>
            <span className="tiny">{arcade.progress}/20명 · {Math.floor(elapsed / 60)}분 {elapsed % 60}초</span>
            {arcade.avg != null && <span className="avg-badge">평균 {arcade.avg}/10</span>}
          </div>
        </div>
        <button className="x" onClick={closePanel} title="접기">▁</button>
      </div>

      <div className="feed" ref={feedRef}>
        {arcade.status === 'summarizing' && <div className="sys-line pulse-text">📊 종합 리포트 작성 중…</div>}
        {arcade.status === 'done' && arcade.summary && (
          <div className="summary-card">
            <pre className="md">{arcade.summary}</pre>
          </div>
        )}
        {[...arcade.reports].reverse().map((r, i) => (
          <div key={i} className={`report ${open === i ? 'open' : ''}`} onClick={() => setOpen(open === i ? null : i)}>
            <div className="report-head">
              <img src={`/assets/sprites/${r.visitor.id}/face.png`} className="face sm" alt="" />
              <div style={{ flex: 1 }}>
                <b>{r.visitor.name}</b> <span className="tiny muted">{r.visitor.age}세 · {r.visitor.job}</span>
                <div className="one-liner">"{r.oneLiner}"</div>
              </div>
              <div className="score-box"><b>{r.score}</b>/10<Star n={r.score} /></div>
            </div>
            {open === i && (
              <div className="report-detail">
                <div>🎯 <b>재미</b> {r.detail.fun}</div>
                <div>📈 <b>난이도</b> {r.detail.difficulty}</div>
                <div>🎮 <b>조작</b> {r.detail.controls}</div>
                <div>🎨 <b>그래픽</b> {r.detail.graphics}</div>
                {r.bugs?.length > 0 && <div className="err">🐛 {r.bugs.join(' / ')}</div>}
                {r.suggestions?.length > 0 && <div>💡 {r.suggestions.join(' / ')}</div>}
                <div className="tiny muted">실플레이: {Math.round((r.telemetry?.ms || 0) / 1000)}초 · 점수 {r.telemetry?.score} · 입력 {r.telemetry?.presses}회 {r.telemetry?.errors ? `· 오류 ${r.telemetry.errors}건` : ''}</div>
              </div>
            )}
          </div>
        ))}
        {running && arcade.reports.length === 0 && (
          <div className="sys-line">손님들이 캐비닛으로 이동해 실제로 게임을 플레이하고 있습니다…<br />맵에서 관전하세요! 봇 플레이 라이브 화면은 좌측 하단에 표시됩니다.</div>
        )}
      </div>

      <div className="panel-foot">
        {running && <button className="danger" onClick={() => { sim.cancel(); useStore.getState().setArcade({ status: 'cancelled' }) }}>시뮬레이션 중단</button>}
        {!running && (
          <>
            <button onClick={onBack}>🏢 사무실로 돌아가기</button>
            <button onClick={() => useStore.getState().setArcade(null) || closePanel()}>닫기</button>
          </>
        )}
      </div>
    </aside>
  )
}
