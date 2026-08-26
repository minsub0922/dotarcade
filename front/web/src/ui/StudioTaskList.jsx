import React, { useEffect, useMemo, useRef, useState } from 'react'

const STATUS_COPY = {
  active: '진행 중',
  available: '바로 실행',
  done: '완료',
  locked: '조건 필요'
}

export default function StudioTaskList({ tasks = [], recommended = null, disabled = false, onSelect }) {
  const [open, setOpen] = useState(false)
  const shellRef = useRef(null)
  const doneCount = tasks.filter(task => task.status === 'done').length
  const nextTask = recommended || tasks.find(task => task.status === 'active') || tasks.find(task => task.enabled) || tasks[0]
  const progress = tasks.length ? (doneCount / tasks.length) * 100 : 0
  const summary = useMemo(() => tasks.find(task => task.status === 'active') || tasks.find(task => task.status === 'available') || nextTask, [tasks, nextTask])

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
    <div ref={shellRef} className={`studio-task-shell ${open ? 'open' : ''}`}>
      <button
        type="button"
        className={`studio-objective ${nextTask.tone || 'idle'}`}
        onClick={() => setOpen(value => !value)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="studio-task-list"
        title="전체 해야 할 일 보기"
      >
        <span className="objective-icon" aria-hidden="true">{summary?.icon || '✓'}</span>
        <span className="objective-copy">
          <small>STUDIO TODO · {doneCount}/{tasks.length || 6} 완료</small>
          <b title={summary?.title}>{summary?.title || '다음 할 일 선택'}</b>
          <span className="objective-track" aria-hidden="true"><i style={{ width: `${Math.max(3, progress)}%` }} /></span>
        </span>
        <span className="objective-next"><small>전체 단계</small><b>할 일 보기</b><i aria-hidden="true">⌄</i></span>
      </button>

      {open && (
        <section id="studio-task-list" className="studio-task-popover" role="dialog" aria-label="스튜디오 해야 할 일">
          <header>
            <div><small>대표의 운영 루프</small><b>해야 할 일 전체 목록</b></div>
            <span>{doneCount}/{tasks.length} 완료</span>
          </header>
          <div className="studio-task-items">
            {tasks.map((task, index) => (
              <button
                key={task.id || `${task.action}-${index}`}
                type="button"
                className={`studio-task-item ${task.status || 'available'}`}
                disabled={!task.enabled || disabled}
                onClick={() => {
                  setOpen(false)
                  onSelect?.(task)
                }}
                title={task.blockReason || task.detail}
              >
                <span className="task-order" aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'locked' ? '⌁' : index + 1}</span>
                <span className="task-copy"><b>{task.title}</b><small>{task.blockReason || task.detail}</small></span>
                <span className="task-state">{STATUS_COPY[task.status] || STATUS_COPY.available}</span>
              </button>
            ))}
          </div>
          <footer>미완료 단계도 조건이 준비되면 순서와 관계없이 바로 실행할 수 있습니다.</footer>
        </section>
      )}
    </div>
  )
}
