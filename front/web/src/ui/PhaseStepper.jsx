import React from 'react'
import { PHASES } from '../meeting/prompts.js'

export const PHASE_ICONS = {
  kickoff: '📣', research: '🔍', concept: '💬', prd: '📋', design: '🎨',
  arch: '📐', review: '👔', impl: '💻', qa: '🧪', release: '🚀'
}
const SHORT = {
  kickoff: '킥오프', research: '리서치', concept: '토론', prd: 'PRD', design: '아트/UX',
  arch: '설계', review: '승인', impl: '구현', qa: 'QA', release: '릴리즈'
}

// BMAD 회의 단계 대형 스테퍼 — 완료 ✓ / 현재(글로우) / 대기 를 한눈에
export default function PhaseStepper({ phase, status }) {
  const idx = Math.max(0, PHASES.findIndex(p => p.key === phase))
  const done = status === 'done'
  const cur = PHASES[idx]
  const pct = done ? 100 : (idx / (PHASES.length - 1)) * 100
  return (
    <div className="ps">
      <div className="ps-now">
        {done ? (
          <><span className="ps-now-icon">🎉</span><b>회의 완료 — 게임 릴리즈!</b><span className="ps-count">{PHASES.length}/{PHASES.length}</span></>
        ) : (
          <>
            <span className="ps-now-icon">{PHASE_ICONS[cur.key]}</span>
            <b>{cur.label}</b>
            <span className="ps-bmad">{cur.bmad}</span>
            <span className="ps-count">{idx + 1}/{PHASES.length}</span>
          </>
        )}
      </div>
      <div className="ps-track">
        <div className="ps-fill" style={{ width: pct + '%' }} />
        {PHASES.map((p, i) => (
          <div key={p.key} className={`ps-step ${done || i < idx ? 'done' : i === idx ? 'now' : ''}`} title={`${p.label} — ${p.bmad}`}>
            <span className="ps-dot">{done || i < idx ? '✓' : PHASE_ICONS[p.key]}</span>
            <span className="ps-label">{SHORT[p.key] || p.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
