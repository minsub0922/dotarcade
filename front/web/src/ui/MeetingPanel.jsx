import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { PHASES } from '../meeting/prompts.js'

const face = id => id === 'player'
  ? '/assets/sprites/player/face.png'
  : `/assets/sprites/${TEAM.find(t => t.id === id)?.sprite || 'pm'}/face.png`
const nameOf = id => id === 'player' ? `${PLAYER.name} (팀장)` : id === 'system' ? '' : (TEAM.find(t => t.id === id)?.name || id)
const colorOf = id => id === 'player' ? '#ffd24a' : TEAM.find(t => t.id === id)?.color || '#8a93c6'

export default function MeetingPanel({ meet, onDeploy, onPlay }) {
  const meeting = useStore(s => s.meeting)
  const games = useStore(s => s.games)
  const closePanel = useStore(s => s.closePanel)
  const [tab, setTab] = useState('feed')
  const [comment, setComment] = useState('')
  const feedRef = useRef(null)

  useEffect(() => { if (tab === 'feed') feedRef.current?.scrollTo(0, 1e9) }, [meeting?.transcript?.length, tab])

  if (!meeting) return null
  const phaseIdx = PHASES.findIndex(p => p.key === meeting.phase)
  const done = meeting.status === 'done'
  const resultGame = done && games.find(g => g.id === meeting.resultGameId)

  return (
    <aside className="panel side wide">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <b>📋 BMAD 회의</b> <span className="muted">{meeting.agenda}</span>
          <div className="phase-strip">
            {PHASES.map((p, i) => (
              <span key={p.key} className={`phase-dot ${i < phaseIdx ? 'past' : i === phaseIdx ? 'now' : ''}`} title={`${p.label} — ${p.bmad}`}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
        <button className="x" onClick={closePanel} title="접기 (회의는 계속 진행됩니다)">▁</button>
      </div>

      <div className="tabs">
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>회의록</button>
        <button className={tab === 'prd' ? 'on' : ''} onClick={() => setTab('prd')} disabled={!meeting.artifacts.prd}>PRD</button>
        <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')} disabled={!meeting.artifacts.design}>디자인</button>
        <button className={tab === 'arch' ? 'on' : ''} onClick={() => setTab('arch')} disabled={!meeting.artifacts.arch}>설계</button>
        <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')} disabled={!meeting.artifacts.code}>코드</button>
      </div>

      {tab === 'feed' ? (
        <div className="feed" ref={feedRef}>
          {meeting.transcript.map((e, i) => {
            if (e.kind === 'system') return <div key={i} className="sys-line">{e.text}</div>
            if (e.kind === 'source') return <div key={i} className="src-line">{e.text}</div>
            const isDoc = e.kind === 'doc' || e.kind === 'note'
            return (
              <div key={i} className={`m-entry ${e.kind}`}>
                {e.agentId !== 'system' && <img src={face(e.agentId)} className="face sm" alt="" />}
                <div className="m-body">
                  <div className="m-name" style={{ color: colorOf(e.agentId) }}>
                    {nameOf(e.agentId)} {e.kind === 'qa' && '· QA'} {e.kind === 'note' && '· 조사 메모'}
                  </div>
                  <div className={`m-text ${isDoc ? 'doc' : ''}`}>{e.text}</div>
                </div>
              </div>
            )
          })}
          {meeting.qaPreview && (
            <div className="qa-preview">
              <div className="tiny muted">🧪 QA 봇 플레이 라이브</div>
              <div id="qa-preview-slot" key={meeting.qaNonce} />
            </div>
          )}
          {meeting.status === 'running' && !meeting.approval && <div className="sys-line pulse-text">진행 중… ({meeting.phaseLabel})</div>}
        </div>
      ) : (
        <div className="feed doc-view">
          <pre className={tab === 'code' ? 'code' : 'md'}>{meeting.artifacts[tab] || ''}</pre>
        </div>
      )}

      {meeting.approval && (
        <div className="approval">
          <div><b>👔 팀장 승인 대기</b> — PRD·디자인·설계를 검토하세요. {meeting.approval.auto && <span className="muted">(자동 진행 예정)</span>}</div>
          <div className="input-row">
            <input value={comment} onChange={e => setComment(e.target.value)} placeholder="추가 요구사항 (선택)" />
            <button className="primary" onClick={() => { meet.approve(comment); setComment('') }}>✅ 승인</button>
          </div>
        </div>
      )}

      <div className="panel-foot">
        {meeting.status === 'running' && <button className="danger" onClick={() => meet.cancel()}>회의 중단</button>}
        {done && resultGame && (
          <>
            <button className="primary" onClick={() => onPlay(resultGame.id)}>▶ {resultGame.emoji} {resultGame.title} 플레이</button>
            <button className="accent" onClick={() => onDeploy(resultGame)}>🕹️ 오락실 배포 & 시뮬레이션</button>
          </>
        )}
        {meeting.status === 'error' && <span className="err">⚠️ {meeting.error}</span>}
        {(done || meeting.status === 'error') && <button onClick={() => { useStore.getState().setMeeting(null); closePanel() }}>닫기</button>}
      </div>
    </aside>
  )
}
