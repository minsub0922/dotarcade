import React, { useEffect, useRef } from 'react'
import { useStore } from '../state/store.js'
import Markdown from './Markdown.jsx'
import Radar from './Radar.jsx'
import { CRITERIA, strongWeak } from '../data/criteria.js'

// 오락실 종합 리포트 팝업 — 전원 평가 완료 후 스트리밍으로 작성 과정을 보여준다
export default function ReportModal({ onReturnOffice }) {
  const arcade = useStore(s => s.arcade)
  const games = useStore(s => s.games)
  const bodyRef = useRef(null)
  const streaming = arcade?.status === 'summarizing'
  const text = (['done', 'report_error'].includes(arcade?.status) ? arcade?.summary : arcade?.summaryStream) || arcade?.summaryStream || ''

  useEffect(() => { bodyRef.current?.scrollTo(0, 1e9) }, [text])
  if (!arcade) return null

  const close = () => useStore.getState().setArcade({ reportSeen: true })

  // 누적 통계 (이번 런 포함되어 갱신됨) — 2회 이상일 때만 비교 폴리곤 표시
  const g = games.find(x => x.id === arcade.gameId)
  const cum = g?.stats?.runs > 1 ? g.stats.ratings : null
  const sw = arcade.ratings ? strongWeak(arcade.ratings) : null

  return (
    <div className="modal-back dark" onClick={e => { if (e.target === e.currentTarget && !streaming) close() }}>
      <div className="modal big report-modal">
        <div className="modal-head">
          <b>📊 오락실 반응 리포트</b>
          <span className="muted tiny">{arcade.emoji} {arcade.title} {arcade.version} · 손님 {arcade.reports?.length || 0}명 평가 완료</span>
          {arcade.avg != null && <span className="avg-badge">평균 {arcade.avg}/10</span>}
          {!streaming && <button className="x" onClick={close}>✕</button>}
        </div>
        <div className="detail-body report-body" ref={bodyRef}>
          {arcade.ratings && (
            <div className="report-radar-row">
              <Radar ratings={arcade.ratings} compare={cum} size={190} color="#ffd24a" compareColor="#7dc7ff" values />
              <div className="report-radar-side">
                <div className="legend">
                  <span><span className="dot" style={{ background: '#ffd24a' }} />이번 시뮬</span>
                  {cum && <span><span className="dot dashed" style={{ background: '#7dc7ff' }} />누적 평균 ({g.stats.runs}회 · {g.stats.reports}명)</span>}
                </div>
                <div className="axis-chips">
                  {CRITERIA.map(c => arcade.ratings[c.key] != null && (
                    <span key={c.key} className="axis-chip" title={c.desc}>{c.label} <b>{arcade.ratings[c.key]}</b>{cum?.[c.key] != null && <i className="cum"> /누적 {cum[c.key]}</i>}</span>
                  ))}
                </div>
                {sw && <div className="sw-line">강점 <b className="good">▲ {sw.top[0]} {sw.top[1]}</b> · 약점 <b className="bad">▼ {sw.low[0]} {sw.low[1]}</b></div>}
              </div>
            </div>
          )}
          {streaming && !text && (
            <div className="sys-line pulse-text">🧮 손님 {arcade.reports?.length || 0}명의 피드백을 종합하는 중…</div>
          )}
          {text && <div className="md"><Markdown text={text} />{streaming && <span className="caret">▌</span>}</div>}
          {arcade.feedbackError && <div className="sys-line err">⚠️ 리포트는 복구했지만 게임팩 피드백 저장에 실패했습니다: {arcade.feedbackError}</div>}
        </div>
        <div className="panel-foot">
          {streaming ? (
            <span className="tiny muted pulse-text">✍️ 운영 분석가가 리포트를 실시간으로 작성 중입니다…</span>
          ) : (
            <>
              <button className="primary" onClick={() => { close(); onReturnOffice() }}>🏢 회의실로 돌아가기 — 업그레이드 회의</button>
              <button onClick={close}>닫기</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
