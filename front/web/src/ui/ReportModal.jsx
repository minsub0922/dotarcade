import React, { useEffect, useRef } from 'react'
import { useStore } from '../state/store.js'
import Markdown from './Markdown.jsx'

// 오락실 종합 리포트 팝업 — 전원 평가 완료 후 스트리밍으로 작성 과정을 보여준다
export default function ReportModal({ onReturnOffice }) {
  const arcade = useStore(s => s.arcade)
  const bodyRef = useRef(null)
  const streaming = arcade?.status === 'summarizing'
  const text = (arcade?.status === 'done' ? arcade?.summary : arcade?.summaryStream) || arcade?.summaryStream || ''

  useEffect(() => { bodyRef.current?.scrollTo(0, 1e9) }, [text])
  if (!arcade) return null

  const close = () => useStore.getState().setArcade({ reportSeen: true })

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
          {streaming && !text && (
            <div className="sys-line pulse-text">🧮 손님 {arcade.reports?.length || 0}명의 피드백을 종합하는 중…</div>
          )}
          {text && <div className="md"><Markdown text={text} />{streaming && <span className="caret">▌</span>}</div>}
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
