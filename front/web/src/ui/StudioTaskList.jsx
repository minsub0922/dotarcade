import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getTaskGuidance, selectGuidedTask, studioTaskKey } from './studioTaskGuidance.js'

const STATUS_COPY = {
  active: '계속하기',
  available: '실행 가능',
  done: '완료',
  locked: '조건 필요'
}

export default function StudioTaskList({ tasks = [], recommended = null, disabled = false, suppressGuide = false, onSelect }) {
  const [open, setOpen] = useState(false)
  const [dismissedGuide, setDismissedGuide] = useState('')
  const shellRef = useRef(null)
  const doneCount = tasks.filter(task => task.status === 'done').length
  const guidedTask = useMemo(() => selectGuidedTask(tasks, recommended), [tasks, recommended])
  const guidedKey = studioTaskKey(guidedTask)
  const guidance = useMemo(() => getTaskGuidance(guidedTask), [guidedTask])
  const nextTask = guidedTask || recommended || tasks.find(task => task.enabled) || tasks[0]
  const progress = tasks.length ? (doneCount / tasks.length) * 100 : 0
  const summary = guidedTask || nextTask
  const showGuide = !!(guidedTask && guidance && !open && !disabled && !suppressGuide && dismissedGuide !== guidedKey)

  const selectTask = task => {
    if (!task?.enabled || disabled) return
    setOpen(false)
    // Selecting any item starts a deliberate flow. Keep the currently
    // recommended coach from reappearing behind that flow.
    setDismissedGuide(guidedKey || studioTaskKey(task))
    onSelect?.(task)
  }

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = event => {
      if (!shellRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!nextTask) return null

  return (
    <div ref={shellRef} className={`studio-task-shell ${open ? 'open' : ''} ${showGuide ? 'has-guide' : ''}`}>
      <button
        type="button"
        className={`studio-objective ${summary?.tone || 'idle'} ${showGuide ? 'attention' : ''}`}
        onClick={() => setOpen(value => !value)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="studio-task-list"
        aria-describedby={showGuide ? 'studio-task-coach' : undefined}
        title="전체 해야 할 일 보기"
      >
        <span className="objective-icon" aria-hidden="true">{summary?.icon || '✓'}</span>
        <span className="objective-copy">
          <small>STUDIO TODO · {doneCount}/{tasks.length || 6} 완료</small>
          <b title={summary?.title}>{summary?.title || '다음 할 일 선택'}</b>
          <span className="objective-track" aria-hidden="true"><i style={{ width: `${Math.max(3, progress)}%` }} /></span>
        </span>
        <span className="objective-next"><small>실행 안내</small><b>할 일 보기</b><i aria-hidden="true">⌄</i></span>
      </button>

      {showGuide && (
        <aside id="studio-task-coach" className="studio-task-coach" role="region" aria-label="다음 할 일 안내">
          <span className="task-coach-icon" aria-hidden="true">{guidedTask.icon || '✦'}</span>
          <span className="task-coach-copy" role="status" aria-live="polite">
            <small>{guidance.label}</small>
            <b>{guidedTask.title}</b>
            <span>{guidance.destination ? `📍 ${guidance.destination} · ` : ''}{guidance.text}</span>
          </span>
          <button type="button" className="task-coach-start" onClick={() => selectTask(guidedTask)}>
            <small>바로 안내</small><b>{guidance.actionLabel} →</b>
          </button>
          <button type="button" className="task-coach-close" onClick={() => setDismissedGuide(guidedKey)} aria-label="다음 할 일 안내 닫기">×</button>
        </aside>
      )}

      {open && (
        <section id="studio-task-list" className="studio-task-popover" role="dialog" aria-label="스튜디오 해야 할 일">
          <header>
            <div><small>대표의 운영 루프</small><b>해야 할 일 전체 목록</b><p>강조된 항목을 누르면 목적지와 다음 화면까지 안내합니다.</p></div>
            <span>{doneCount}/{tasks.length} 완료</span>
          </header>
          <div className="studio-task-items">
            {tasks.map((task, index) => {
              const highlighted = !!guidedKey && studioTaskKey(task) === guidedKey
              const itemGuidance = getTaskGuidance(task)
              const stateCopy = task.status === 'done' && task.enabled ? '다시 하기' : (STATUS_COPY[task.status] || STATUS_COPY.available)
              return (
                <button
                  key={task.id || `${task.action}-${index}`}
                  type="button"
                  className={`studio-task-item ${task.status || 'available'} ${highlighted ? 'recommended' : ''}`}
                  disabled={!task.enabled || disabled}
                  onClick={() => selectTask(task)}
                  title={task.blockReason || task.detail}
                  aria-current={highlighted ? 'step' : undefined}
                  aria-describedby={highlighted ? `studio-task-guide-${task.id || index}` : undefined}
                >
                  <span className="task-order" aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'locked' ? '⌁' : index + 1}</span>
                  <span className="task-copy">
                    <span className="task-title"><b>{task.title}</b>{highlighted && <em>추천</em>}</span>
                    <small>{task.blockReason || task.detail}</small>
                    {highlighted && itemGuidance && (
                      <span id={`studio-task-guide-${task.id || index}`} className="task-guide-line">
                        {itemGuidance.destination && <i>📍 {itemGuidance.destination}</i>}
                        <span>{itemGuidance.text}</span>
                      </span>
                    )}
                  </span>
                  <span className="task-state"><b>{stateCopy}</b><small>{task.enabled ? `${task.actionLabel || '시작'} →` : '잠김'}</small></span>
                </button>
              )
            })}
          </div>
          <footer>실행 가능한 항목은 순서와 관계없이 선택할 수 있습니다 · 잠긴 항목에는 해제 조건이 표시됩니다.</footer>
        </section>
      )}
    </div>
  )
}
