import React, { useEffect, useRef } from 'react'

export default function MilestoneConfirm({ milestone, journey, carry, onConfirm, onCancel }) {
  const primaryRef = useRef(null)
  const moving = journey?.status === 'moving'

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = event => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  if (!milestone) return null

  if (moving) {
    return (
      <aside className="milestone-journey-chip" role="status" aria-live="polite">
        <span className="journey-spinner" aria-hidden="true" />
        <span className="journey-copy">
          <b>{journey.label || `${milestone.destination}까지 자동 이동 중`}</b>
          <small>{milestone.arrivalNote || `도착하면 ${milestone.actionLabel} 단계가 자동으로 시작됩니다.`}</small>
        </span>
        <button onClick={onCancel}>취소</button>
      </aside>
    )
  }

  return (
    <div className="modal-back milestone-confirm-back" onClick={event => event.target === event.currentTarget && onCancel()}>
      <section className="modal milestone-confirm" role="dialog" aria-modal="true" aria-labelledby="milestone-confirm-title">
        <div className="milestone-confirm-accent" aria-hidden="true"><span>{milestone.icon}</span></div>
        <div className="milestone-confirm-body">
          <span className="modal-kicker">{milestone.kicker}</span>
          <h2 id="milestone-confirm-title">{milestone.confirmTitle || `${milestone.actionLabel} 단계를 시작할까요?`}</h2>
          <p>{milestone.detail}</p>

          <div className="milestone-route" aria-label={`현재 위치, 목적지 ${milestone.destination}, 도착 후 ${milestone.actionLabel}`}>
            <span className="done"><i>✓</i><small>현재 위치</small></span>
            <b aria-hidden="true">→</b>
            <span><i>2</i><small>{milestone.destination}</small></span>
            <b aria-hidden="true">→</b>
            <span><i>3</i><small>{milestone.actionLabel}</small></span>
          </div>

          {carry?.label && <div className="milestone-carry-note">✋ {carry.verb || '들고 있는'} 「{carry.label}」은 공간 이동 또는 다음 단계 시작 직전에 안전하게 내려놓습니다.</div>}

          <div className="milestone-start-note"><b>다음</b><span>강조된 버튼을 누르면 목적지까지 안내하고, 도착 후 해야 할 일을 바로 보여드려요.</span></div>

          <div className="actions milestone-confirm-actions">
            <button onClick={onCancel}>취소</button>
            <button ref={primaryRef} className="primary milestone-guide-start" onClick={onConfirm}>안내 시작 · {milestone.actionLabel}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
