import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { isMeetingActive, isMeetingPaused, isMeetingTransitioning, meetingStatusCopy } from '../meeting/status.js'
import Markdown from './Markdown.jsx'
import PhaseStepper from './PhaseStepper.jsx'
import ReferenceDiscovery from './ReferenceDiscovery.jsx'

const face = id => id === 'player'
  ? '/assets/sprites_v2/player/face.png'
  : `/assets/sprites_v2/${TEAM.find(t => t.id === id)?.sprite || 'pm'}/face.png`
const nameOf = id => id === 'player' ? `${PLAYER.name} (팀장)` : id === 'system' ? '' : (TEAM.find(t => t.id === id)?.name || id)
const colorOf = id => id === 'player' ? '#ffd24a' : TEAM.find(t => t.id === id)?.color || '#8a93c6'
const checkpointTime = value => {
  if (!value) return ''
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const referenceStatusLabel = status => ({
  pending: '준비 중',
  planning: '키워드 설계 중',
  searching: '병렬 검색 중',
  selecting: '타겟 선정 중',
  'ui-search': 'UI 탐색 중',
  contracting: '제작 계약 중',
  done: '레퍼런스 준비 완료',
  fallback: '대체 출처 준비 완료',
  error: '확인 필요'
}[status] || '탐색 중')

const interventionDraftKey = id => `dotcade-meeting-intervention-${id}`

const readInterventionDraft = id => {
  if (!id) return ''
  try { return sessionStorage.getItem(interventionDraftKey(id)) || '' } catch { return '' }
}

const writeInterventionDraft = (id, value) => {
  if (!id) return
  try {
    if (value) sessionStorage.setItem(interventionDraftKey(id), value)
    else sessionStorage.removeItem(interventionDraftKey(id))
  } catch { /* storage unavailable */ }
}

export default function MeetingPanel({ meet, onDeploy, onPlay }) {
  const meeting = useStore(s => s.meeting)
  const games = useStore(s => s.games)
  const studio = useStore(s => s.studio)
  const closePanel = useStore(s => s.closePanel)
  const toast = useStore(s => s.toast)
  const [tab, setTab] = useState('feed')
  const [clock, setClock] = useState(Date.now())
  const [intervention, setIntervention] = useState('')
  const [meetingAction, setMeetingAction] = useState('')
  const [actionError, setActionError] = useState('')
  const [referenceOpen, setReferenceOpen] = useState(false)
  const feedRef = useRef(null)
  const qaPreviewRef = useRef(null)
  const referenceTriggerRef = useRef(null)
  const referenceCloseRef = useRef(null)
  const referenceWasOpenRef = useRef(false)
  const reference = meeting?.research?.reference || meeting?.referenceResearch || meeting?.referenceDiscovery
  const referenceAvailable = !!(meeting?.research || reference?.enabled)
  const scoutVisible = referenceOpen && referenceAvailable

  useEffect(() => { if (tab === 'feed') feedRef.current?.scrollTo(0, 1e9) }, [meeting?.transcript?.length, tab])
  useEffect(() => {
    if (!meeting?.directionGate && !meeting?.approval) return
    setClock(Date.now())
    const id = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(id)
  }, [meeting?.directionGate?.until, meeting?.approval?.until])
  useEffect(() => {
    setIntervention(readInterventionDraft(meeting?.id))
    setMeetingAction('')
    setActionError('')
    setReferenceOpen(false)
  }, [meeting?.id])
  useEffect(() => {
    writeInterventionDraft(meeting?.id, intervention)
  }, [meeting?.id, intervention])
  useEffect(() => {
    if (scoutVisible || tab !== 'feed') return
    const frame = requestAnimationFrame(() => feedRef.current?.scrollTo(0, 1e9))
    return () => cancelAnimationFrame(frame)
  }, [scoutVisible, tab])
  useEffect(() => {
    if (!meeting?.qaPreview) return
    if (tab !== 'feed') {
      setTab('feed')
      return
    }
    const frame = requestAnimationFrame(() => {
      const feed = feedRef.current
      const preview = qaPreviewRef.current
      if (feed && preview) feed.scrollTo({ top: Math.max(0, preview.offsetTop - feed.offsetTop - 10), behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [meeting?.qaPreview, meeting?.qaNonce, tab])
  useEffect(() => {
    let frame
    if (scoutVisible) {
      referenceWasOpenRef.current = true
      frame = requestAnimationFrame(() => referenceCloseRef.current?.focus())
    } else if (referenceWasOpenRef.current) {
      referenceWasOpenRef.current = false
      frame = requestAnimationFrame(() => referenceTriggerRef.current?.focus())
    }
    return () => frame && cancelAnimationFrame(frame)
  }, [scoutVisible])
  useEffect(() => {
    if (!scoutVisible) return
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setReferenceOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [scoutVisible])

  if (!meeting) return null
  const done = meeting.status === 'done'
  const stopped = meeting.status === 'cancelled'
  const active = isMeetingActive(meeting)
  const paused = isMeetingPaused(meeting)
  const transitioning = isMeetingTransitioning(meeting)
  const runtime = meetingStatusCopy(meeting)
  const checkpoint = meeting.checkpointMeta || meeting.checkpoint || meeting.lastCheckpoint || null
  const checkpointRevision = checkpoint?.revision ?? meeting.checkpointRevision ?? meeting.revision ?? null
  const checkpointSavedAt = checkpoint?.savedAt || checkpoint?.updatedAt || checkpoint?.createdAt || meeting.checkpointedAt || meeting.savedAt
  const checkpointSavedLabel = checkpointTime(checkpointSavedAt)
  const checkpointError = meeting.checkpointError || checkpoint?.error
  const statusError = meeting.status === 'error' ? meeting.error : null
  const runtimeError = checkpointError || actionError || statusError
  const runtimeErrorLabel = checkpointError ? '체크포인트 오류' : actionError ? '회의 제어 오류' : '회의 오류'
  const actionBusy = !!meetingAction || transitioning
  const interventionText = intervention.trim()
  const resultGame = done && games.find(g => g.id === meeting.resultGameId)
  const qaActive = active && meeting.phase === 'qa'
  const qaSkipPending = !!meeting.qaSkipPending || meetingAction === 'skipQa'
  const qaSkippable = qaActive && meeting.qaSkippable !== false
  const qaCanSkip = qaSkippable && ['running', 'paused', 'error'].includes(meeting.status) && !actionBusy && !qaSkipPending
  const researchMembers = Object.values(meeting.research?.members || {})
  const ragDone = researchMembers.filter(x => x.rag === 'done').length
  const webTargets = researchMembers.filter(x => x.web !== 'skipped')
  const webDone = webTargets.filter(x => ['done', 'fallback', 'unavailable'].includes(x.web)).length
  const directionSeconds = meeting.directionGate
    ? Math.max(0, Math.ceil((meeting.directionGate.until - clock) / 1000))
    : 0
  const approvalSeconds = meeting.approval
    ? Math.max(0, Math.ceil((meeting.approval.until - clock) / 1000))
    : 0

  async function invokeMeetingAction(name, action, { clearDraft = false } = {}) {
    if (meetingAction) return
    setMeetingAction(name)
    setActionError('')
    try {
      if (typeof action !== 'function') throw new Error('회의 제어 기능을 사용할 수 없습니다.')
      await action()
      if (clearDraft) setIntervention('')
    } catch (error) {
      const message = String(error?.message || error || '회의 상태를 변경하지 못했습니다.')
      setActionError(message)
      toast(message, 'warn')
    } finally {
      setMeetingAction('')
    }
  }

  function pauseMeeting(includeIntervention = false) {
    const text = includeIntervention ? interventionText : ''
    return invokeMeetingAction('pause', () => meet?.pause?.(text || undefined), { clearDraft: !!text })
  }

  function resumeMeeting() {
    const text = interventionText
    return invokeMeetingAction('resume', () => meet?.resume?.(text || undefined), { clearDraft: !!text })
  }

  function skipQa() {
    return invokeMeetingAction('skipQa', () => meet?.skipQa?.())
  }

  function primaryInterventionAction() {
    if (paused) return resumeMeeting()
    if (meeting.status === 'running' && interventionText) return pauseMeeting(true)
  }

  return (
    <aside className="panel side wide meeting-panel">
      <div className="panel-head">
        <div className="meeting-panel-title">
          <b>📋 BMAD 회의</b>
          <span className="muted" title={meeting.agenda}>{meeting.agenda}</span>
        </div>
        {referenceAvailable && (
          <button
            type="button"
            ref={referenceTriggerRef}
            className={`reference-scout-trigger status-${reference?.status || 'pending'}`}
            onClick={() => setReferenceOpen(value => !value)}
            aria-expanded={scoutVisible}
            aria-controls="meeting-reference-scout"
          >
            <span>🔎 레퍼런스 스카우트</span>
            <small>{referenceStatusLabel(reference?.status)}{researchMembers.length ? ` · RAG ${ragDone}/${researchMembers.length}` : ''}</small>
          </button>
        )}
        <button className="x" onClick={closePanel} title="접기 (회의는 계속 진행됩니다)">▁</button>
      </div>
      <div
        className="meeting-panel-content"
        aria-hidden={scoutVisible || undefined}
        {...(scoutVisible ? { inert: '' } : {})}
      >
        <PhaseStepper phase={meeting.phase} status={meeting.status} />

      {(active || checkpointSavedAt || runtimeError) && (
        <div className={`meeting-runtime ${runtime.tone}`} role="status" aria-live="polite">
          <span className="meeting-runtime-state"><em>STATE</em><i aria-hidden="true" /><b>{runtime.label}</b></span>
          <span className="checkpoint-meta">
            {runtimeError
              ? <span className="checkpoint-error">⚠ {runtimeErrorLabel} · {String(runtimeError?.message || runtimeError)}</span>
              : checkpointSavedLabel
                ? <>✓ 전체 컨텍스트 저장 {checkpointSavedLabel}{checkpointRevision != null ? ` · r${checkpointRevision}` : ''}</>
                : active ? '첫 체크포인트 준비 중…' : '저장된 체크포인트 없음'}
          </span>
        </div>
      )}

      {meeting.directionGate && (
        <section className="direction-gate">
          <div className="direction-gate-head">
            <div><b>🧭 이번 빌드의 방향</b><div className="tiny muted">한 번만 고르면 토론·PRD·구현에 자동 반영됩니다.</div></div>
            <span className="direction-countdown">{paused ? '일시정지됨' : `${directionSeconds}초 후 추천 선택`}</span>
          </div>
          <div className="direction-grid">
            {meeting.directionGate.options.map(option => (
              <button
                key={option.id}
                className={`direction-card ${option.recommended ? 'recommended' : ''}`}
                onClick={() => meet.chooseDirection(option.id)}
                disabled={meeting.status !== 'running' || actionBusy}
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
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>💬 회의록 · 대화</button>
        <button className={tab === 'prd' ? 'on' : ''} onClick={() => setTab('prd')} disabled={!meeting.artifacts.prd || meeting.qaPreview}>PRD</button>
        <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')} disabled={!meeting.artifacts.design || meeting.qaPreview}>디자인</button>
        <button className={tab === 'arch' ? 'on' : ''} onClick={() => setTab('arch')} disabled={!meeting.artifacts.arch || meeting.qaPreview}>설계</button>
        <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')} disabled={!meeting.artifacts.code || meeting.qaPreview}>코드</button>
      </div>

      {qaActive && (
        <section className={`qa-fast-track ${qaSkipPending ? 'pending' : ''}`} aria-label="QA 빠른 배포 선택">
          <span className="qa-fast-icon" aria-hidden="true">🧪</span>
          <div>
            <b>{meeting.qaActivity === 'repairing' ? 'QA 오류 수리 중' : '자동 QA 진행 중'}</b>
            <small>완료를 기다리거나, 미검증 상태를 기록하고 바로 릴리즈할 수 있습니다.</small>
          </div>
          <button type="button" className="qa-skip-button" onClick={skipQa} disabled={!qaCanSkip}>
            {qaSkipPending ? '빠른 배포 준비 중…' : '⚡ QA 스킵 · 빠른 배포'}
          </button>
        </section>
      )}

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
            <div className="qa-preview" ref={qaPreviewRef}>
              <div className="qa-preview-head">
                <span><b>QA 봇 플레이 라이브</b><small>생성된 게임을 자동 조작하며 렌더링과 입력 반응을 확인합니다.</small></span>
                <em><i /> LIVE</em>
              </div>
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
          <div><b>🚀 출시 준비 확인</b> — 선택한 방향과 문서를 이대로 구현합니다. {meeting.approval.auto && <span className="muted">({paused ? '일시정지됨' : `${approvalSeconds}초 후 자동 진행`})</span>}</div>
          <button className="primary approval-go" onClick={() => meet.approve()} disabled={meeting.status !== 'running' || actionBusy}>✅ 준비 완료 · 구현 시작</button>
        </div>
      )}

      {active && (
        <section className={`human-loop ${paused ? 'paused' : ''}`} aria-label="팀장 개입">
          <div className="human-loop-head">
            <div>
              <b>✋ 팀장 개입</b>
              <small>{paused ? '체크포인트의 전체 팀 컨텍스트를 유지한 채 지시를 더하고 재개할 수 있습니다.' : '언제든 안전한 체크포인트에서 멈추고 방향을 조정할 수 있습니다.'}</small>
            </div>
            {paused && <span className="human-loop-badge">PAUSED</span>}
          </div>
          <div className="human-compose">
            <textarea
              rows={2}
              maxLength={2000}
              value={intervention}
              onChange={event => setIntervention(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !actionBusy) {
                  event.preventDefault()
                  primaryInterventionAction()
                }
              }}
              disabled={actionBusy}
              placeholder={paused ? '재개할 때 모든 팀원이 반영할 지시를 입력하세요…' : '예: 범위를 줄이고 모바일 한 손 조작을 우선해 주세요.'}
              aria-label="모든 팀원에게 전달할 개입 지시"
            />
            <div className="human-actions">
              {meeting.status === 'running' && (
                <>
                  <button onClick={() => pauseMeeting(false)} disabled={actionBusy}>Ⅱ 일시정지</button>
                  <button className="primary" onClick={() => pauseMeeting(true)} disabled={actionBusy || !interventionText}>✋ 지시 전달 · 정지</button>
                </>
              )}
              {paused && (
                <button className="primary" onClick={resumeMeeting} disabled={actionBusy}>
                  {interventionText ? '▶ 지시 반영 · 재개' : '▶ 그대로 재개'}
                </button>
              )}
              {transitioning && <button disabled>{meeting.status === 'pausing' ? '체크포인트 저장 중…' : '컨텍스트 복원 중…'}</button>}
            </div>
          </div>
          <div className="human-loop-note"><span>⌘/Ctrl + Enter로 실행</span><span>{intervention.length}/2000</span></div>
        </section>
      )}

      {done && resultGame && (
        <section className="release-ready" aria-live="polite">
          <span className="release-ready-icon" aria-hidden="true">🚀</span>
          <div className="release-ready-copy">
            <small>{meeting.upgrade ? 'NEW VERSION READY' : 'NEW GAME READY'}</small>
            <b>{resultGame.emoji} {resultGame.title} 제작 완료</b>
            <span>다음 단계로 오락실에 배포하고 AI 손님 20명의 플레이 시뮬레이션을 시작하세요.</span>
          </div>
          <div className="release-ready-actions">
            <button className="deploy-primary" onClick={() => onDeploy(resultGame)}>
              {meeting.upgrade ? '🚀 업데이트 배포하기' : '🚀 신규 게임 배포하기'}
              <small>배포 시뮬레이션으로 이동</small>
            </button>
            <button onClick={() => onPlay(resultGame.id)}>▶ 먼저 플레이</button>
          </div>
        </section>
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

      {(done || stopped) && <div className="panel-foot">
        {meeting.status === 'cancelled' && <span className="muted">회의가 중단되었습니다.</span>}
        {(done || stopped) && <button onClick={() => { useStore.getState().setMeeting(null); closePanel() }}>닫기</button>}
      </div>}
      </div>

      {scoutVisible && (
        <section id="meeting-reference-scout" className="meeting-scout-layer" role="dialog" aria-labelledby="meeting-reference-scout-title">
          <header className="meeting-scout-head">
            <div>
              <small>REFERENCE SCOUT</small>
              <b id="meeting-reference-scout-title">🔎 회의 레퍼런스 스카우트</b>
            </div>
            <span className={`scout-status status-${reference?.status || 'pending'}`} aria-live="polite">{referenceStatusLabel(reference?.status)}</span>
            <button ref={referenceCloseRef} type="button" className="x" onClick={() => setReferenceOpen(false)} aria-label="레퍼런스 스카우트 닫기">✕</button>
          </header>
          {meeting.research && (
            <div className="research-brief">
              <div className="research-brief-head">
                <b>리서치 레이더</b>
                <span className="tiny muted">RAG {ragDone}/{researchMembers.length} · 검색 {webDone}/{webTargets.length}</span>
              </div>
              <div className="research-keywords" aria-label="주요 기술 키워드">
                <span className="research-keyword-label">TECH</span>
                {(meeting.research.keywords || []).map(k => <span className="chip" key={k}>#{k}</span>)}
                {!meeting.research.keywords?.length && <span className="tiny muted">핵심 키워드 수집 중…</span>}
              </div>
            </div>
          )}
          <ReferenceDiscovery reference={reference} standalone />
        </section>
      )}
    </aside>
  )
}
