import React from 'react'

export default function TaskGuideChip({ guide, onClose }) {
  if (!guide) return null
  return (
    <aside className="task-action-guide" role="status" aria-live="polite" aria-label="할 일 실행 안내">
      <span className="task-action-guide-icon" aria-hidden="true">{guide.icon || '💬'}</span>
      <span className="task-action-guide-copy">
        <small>할 일 실행 안내 · 대상이 바닥에 강조됩니다</small>
        <b>{guide.title}</b>
        <span>{guide.text}</span>
      </span>
      <span className="task-action-guide-keys" aria-label="E로 대화하거나 E로 소품을 집은 뒤 F로 던지기">
        <span><kbd>E</kbd> 대화</span><em>또는</em><span><kbd>E</kbd> 집기 <b>→</b> <kbd>F</kbd> 던지기</span>
      </span>
      <button type="button" className="task-action-guide-close" onClick={onClose} aria-label="할 일 실행 안내 닫기">×</button>
    </aside>
  )
}
