import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { PHASES } from '../meeting/prompts.js'
import Markdown from './Markdown.jsx'
import PhaseStepper from './PhaseStepper.jsx'
import ReferenceDiscovery from './ReferenceDiscovery.jsx'

const face = id => id === 'player'
  ? '/assets/sprites_v2/player/face.png'
  : `/assets/sprites_v2/${TEAM.find(t => t.id === id)?.sprite || 'pm'}/face.png`
const nameOf = id => id === 'player' ? `${PLAYER.name} (팀장)` : id === 'system' ? '' : (TEAM.find(t => t.id === id)?.name || id)
const colorOf = id => id === 'player' ? '#ffd24a' : TEAM.find(t => t.id === id)?.color || '#8a93c6'

export default function MeetingPanel({ meet, onDeploy, onPlay }) {
  const meeting = useStore(s => s.meeting)
  const games = useStore(s => s.games)
  const studio = useStore(s => s.studio)
  const closePanel = useStore(s => s.closePanel)
  const [tab, setTab] = useState('feed')
  const [clock, setClock] = useState(Date.now())
  const feedRef = useRef(null)

  useEffect(() => { if (tab === 'feed') feedRef.current?.scrollTo(0, 1e9) }, [meeting?.transcript?.length, tab])
  useEffect(() => {
    if (!meeting?.directionGate && !meeting?.approval) return
    setClock(Date.now())
    const id = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(id)
  }, [meeting?.directionGate?.until, meeting?.approval?.until])

  if (!meeting) return null
  const phaseIdx = PHASES.findIndex(p => p.key === meeting.phase)
  const done = meeting.status === 'done'
  const stopped = meeting.status === 'error' || meeting.status === 'cancelled'
  const resultGame = done && games.find(g => g.id === meeting.resultGameId)
  const researchMembers = Object.values(meeting.research?.members || {})
  const ragDone = researchMembers.filter(x => x.rag === 'done').length
  const webTargets = researchMembers.filter(x => x.web !== 'skipped')
  const webDone = webTargets.filter(x => ['done', 'fallback', 'unavailable'].includes(x.web)).length
  const reference = meeting.research?.reference || meeting.referenceResearch || meeting.referenceDiscovery
  const directionSeconds = meeting.directionGate
    ? Math.max(0, Math.ceil((meeting.directionGate.until - clock) / 1000))
    : 0
  const approvalSeconds = meeting.approval
    ? Math.max(0, Math.ceil((meeting.approval.until - clock) / 1000))
    : 0

  return (
    <aside className="panel side wide">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <b>📋 BMAD 회의</b> <span className="muted">{meeting.agenda}</span>
        </div>
        <button className="x" onClick={closePanel} title="접기 (회의는 계속 진행됩니다)">▁</button>
      </div>
      <PhaseStepper phase={meeting.phase} status={meeting.status} />

      {meeting.research && (
        <div className="research-brief">
          <div className="research-brief-head">
            <b>🔎 리서치 레이더</b>
            <span className="tiny muted">RAG {ragDone}/{researchMembers.length} · 검색 {webDone}/{webTargets.length}</span>
          </div>
          <div className="research-keywords" aria-label="주요 기술 키워드">
            <span className="research-keyword-label">TECH</span>
            {(meeting.research.keywords || []).map(k => <span className="chip" key={k}>#{k}</span>)}
            {!meeting.research.keywords?.length && <span className="tiny muted">핵심 키워드 수집 중…</span>}
          </div>
        </div>
      )}

      <ReferenceDiscovery reference={reference} />

      {meeting.directionGate && (
        <section className="direction-gate">
          <div className="direction-gate-head">
            <div><b>🧭 이번 빌드의 방향</b><div className="tiny muted">한 번만 고르면 토론·PRD·구현에 자동 반영됩니다.</div></div>
            <span className="direction-countdown">{directionSeconds}초 후 추천 선택</span>
          </div>
          <div className="direction-grid">
            {meeting.directionGate.options.map(option => (
              <button
                key={option.id}
                className={`direction-card ${option.recommended ? 'recommended' : ''}`}
                onClick={() => meet.chooseDirection(option.id)}
              >
                <span className="direction-card-top"><i>{option.icon}</i><b>{option.title}</b>{option.recommended && <em>추천</em>}</span>
                <span className="direction-tag">{option.tag}</span>
                <span className="direction-summary">{option.summary}</span>
                <span className="direction-mission"><b>이번 KPI</b> {option.mission.label}</span>
                <small>리스크 · {option.risk}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {meeting.direction && !meeting.directionGate && (
        <div className="build-direction">
          <span className="build-direction-icon">{meeting.direction.icon}</span>
          <div><b>{meeting.direction.title}</b><small>{meeting.direction.summary}</small></div>
          <span className="build-mission"><b>🎯 빌드 미션</b>{meeting.direction.mission.label}</span>
        </div>
      )}

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
                  <div className={`m-text ${isDoc ? 'doc' : ''}`}><Markdown text={e.text} /></div>
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
          {tab === 'code'
            ? <pre className="code">{meeting.artifacts[tab] || ''}</pre>
            : <Markdown className="md" text={meeting.artifacts[tab] || ''} />}
        </div>
      )}

      {meeting.approval && (
        <div className="approval">
          <div><b>🚀 출시 준비 확인</b> — 선택한 방향과 문서를 이대로 구현합니다. {meeting.approval.auto && <span className="muted">({approvalSeconds}초 후 자동 진행)</span>}</div>
          <button className="primary approval-go" onClick={() => meet.approve()}>✅ 준비 완료 · 구현 시작</button>
        </div>
      )}

      {done && meeting.reward && (
        <div className="studio-reward">
          <span className="reward-burst">🎁</span>
          <div><b>릴리스 보상</b><small>{meeting.reward.reason} · 스튜디오 Lv.{studio.level}</small></div>
          <strong>+{meeting.reward.xp} XP</strong>
          <strong>+{meeting.reward.coins} 🪙</strong>
          <span className="streak-badge">{meeting.reward.streak > 0 ? `🔥 안정 출시 ${meeting.reward.streak}연승` : '연승 재도전'}</span>
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
        {meeting.status === 'cancelled' && <span className="muted">회의가 중단되었습니다.</span>}
        {(done || stopped) && <button onClick={() => { useStore.getState().setMeeting(null); closePanel() }}>닫기</button>}
      </div>
    </aside>
  )
}
