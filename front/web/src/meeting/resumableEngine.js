// DOTCADE — durable, interruptible BMAD meeting runner
import { api as defaultApi } from '../api.js'
import { TEAM, PLAYER } from '../data/personas.js'
import { personaSystem, P, PHASES } from './prompts.js'
import { runSmokeTest, extractCode } from '../game/qa.js'
import { useStore } from '../state/store.js'
import {
  normalizeReferenceDesignContract,
  referenceImplementationMarkdown,
  visualQaRequiredScreens
} from './referenceContract.js'
import {
  MeetingCheckpointer,
  RESUMABLE_MEETING_STATUSES,
  appendHumanIntervention,
  createMeetingRunContext,
  recordAgentExchange
} from './checkpointer.js'
import {
  buildDirections,
  bumpVersion,
  extractKeywords,
  formatReferenceBrief,
  localReferenceFallback,
  pickCheer,
  referenceMarkdown
} from './workflowSupport.js'

const clone = value => value == null
  ? value
  : (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const S = () => useStore.getState()

class PauseSignal extends Error { constructor() { super('meeting-paused'); this.name = 'PauseSignal' } }
class CancelSignal extends Error { constructor() { super('meeting-cancelled'); this.name = 'CancelSignal' } }
class QaSkipSignal extends Error { constructor() { super('meeting-qa-skipped'); this.name = 'QaSkipSignal' } }
class CheckpointSaveError extends Error {
  constructor(cause) {
    super(`체크포인트 저장 실패: ${String(cause?.message || cause)}`)
    this.name = 'CheckpointSaveError'
    this.cause = cause
    this.code = cause?.code || null
    this.status = cause?.status || null
    this.remoteCheckpoint = cause?.remoteCheckpoint || null
  }
}
const isAbortError = error => error?.name === 'AbortError' || /aborted|abort/i.test(String(error?.message || ''))
const abortError = message => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export class MeetingEngine {
  constructor(world, dependencies = {}) {
    this.world = world
    this.api = dependencies.api || defaultApi
    this.smokeTest = dependencies.smokeTest || runSmokeTest
    this.sleep = dependencies.sleep || wait
    this.cancelled = false
    this.pauseRequested = false
    this.qaSkipRequested = false
    this.context = null
    this._abort = null
    this._approval = null
    this._direction = null
    this._runPromise = null
    this._controlSave = null
    this._pendingControl = []
    this.checkpointer = dependencies.checkpointer || new MeetingCheckpointer({
      saveRemote: (id, body) => this.api.putMeetingCheckpoint(id, body),
      loadLatestRemote: () => this.api.activeMeeting(),
      loadRemote: id => this.api.meeting(id)
    })
  }

  async run(agenda, { upgradeGame = null, referenceSearch = false, referenceTarget = '' } = {}) {
    if (this._runPromise || RESUMABLE_MEETING_STATUSES.has(S().meeting?.status)) {
      throw new Error('이미 회의가 진행 중입니다')
    }
    this.cancelled = false
    this.pauseRequested = false
    this.qaSkipRequested = false
    this._pendingControl = []
    const record = await this.api.createMeeting({
      agenda,
      gameId: upgradeGame?.id || null,
      type: upgradeGame ? 'upgrade' : 'new',
      status: 'running'
    })
    const meetingId = record?.meeting?.id
    if (!meetingId) throw new Error('회의를 영속 저장소에 만들지 못했습니다')

    this.checkpointer.revision = Number(record.meeting.revision) || 0
    this.checkpointer.last = null
    this.checkpointer.clearLocal()
    this.context = createMeetingRunContext({ agenda, upgradeGame, referenceSearch, referenceTarget })
    const initialResearch = {
      status: 'pending',
      keywords: extractKeywords(agenda, 6),
      reference: {
        enabled: !!referenceSearch,
        status: referenceSearch ? 'pending' : 'disabled',
        keywords: [], queries: [], completedQueries: 0, totalQueries: 0,
        candidates: [], selected: null, uiReferences: [], sources: [], evidence: [],
        reason: '', fallback: false, error: null
      },
      members: Object.fromEntries(TEAM.map(member => [member.id, {
        rag: 'pending', ragHits: 0,
        web: ['writer', 'pm', 'designer'].includes(member.id)
          ? (S().config.webSearch ? 'pending' : 'unavailable')
          : 'skipped',
        webHits: 0, note: 'pending'
      }]))
    }
    S().replaceMeeting({
      id: meetingId,
      agenda,
      phase: 'kickoff',
      phaseLabel: '킥오프',
      transcript: [],
      artifacts: {},
      status: 'running',
      gameId: upgradeGame?.id || null,
      upgrade: !!upgradeGame,
      approval: null,
      qaPreview: false,
      qaSkippable: false,
      qaSkipPending: false,
      qaSkipped: false,
      qaActivity: null,
      research: initialResearch,
      directionGate: null,
      direction: null,
      reward: null,
      interventions: [],
      checkpointMeta: null,
      checkpointError: null,
      hitl: { status: 'idle', pending: [] }
    })
    S().openPanel('meeting')
    // The first durability boundary precedes animation so even an immediate
    // reload can reconstruct all five empty agent ledgers and the kickoff cursor.
    try { await this._checkpoint('running') } catch (error) {
      S().setMeeting({ status: 'error', checkpointError: error.message })
      this._say('system', 'system', `⚠️ ${error.message}`)
      this._releaseMeetingSeats()
      throw error
    }
    this._seatMeeting()
    await this.sleep(1400)
    return this._drive()
  }

  async restoreLatest() {
    if (this._runPromise || RESUMABLE_MEETING_STATUSES.has(S().meeting?.status)) return S().meeting
    const checkpoint = await this.checkpointer.loadLatest()
    if (!checkpoint || !RESUMABLE_MEETING_STATUSES.has(checkpoint.status)) return null
    this.context = checkpoint.context
    this.cancelled = false
    this.pauseRequested = false
    this.qaSkipRequested = false
    this._pendingControl = []
    const restored = {
      ...checkpoint.meeting,
      status: 'paused',
      qaPreview: false,
      qaSkipPending: false,
      approval: checkpoint.context.gates?.approval ? checkpoint.meeting.approval : null,
      directionGate: checkpoint.context.gates?.direction ? checkpoint.meeting.directionGate : null,
      checkpointMeta: this._checkpointMeta(checkpoint),
      checkpointError: null,
      recovered: true,
      hitl: { status: 'paused', pending: checkpoint.context.pendingInterventions || [] }
    }
    // A restored tab is paused regardless of how long it was closed. Preserve
    // the gate's remaining choice window instead of letting wall-clock time
    // silently auto-select while no human was present.
    const checkpointTime = Date.parse(checkpoint.savedAt)
    this._freezeGateTimers(this.context, restored, Number.isFinite(checkpointTime) ? checkpointTime : Date.now())
    S().replaceMeeting(restored)
    this._consumePendingInterventions()
    S().setMeeting({ hitl: { status: 'paused', pending: [] } })
    S().openPanel('meeting')
    this._seatMeeting()
    this._say('system', 'system', '♻️ 저장된 전체 멀티에이전트 컨텍스트를 복원했습니다. 팀장 지시를 추가하거나 그대로 재개할 수 있습니다.')
    try { await this._checkpoint('paused') } catch (error) {
      S().setMeeting({ status: 'paused', checkpointError: error.message, hitl: { status: 'error', pending: [] } })
      throw error
    }
    return S().meeting
  }

  pause(text = '') {
    const meeting = S().meeting
    if (!meeting || !['running', 'resuming'].includes(meeting.status)) return Promise.resolve(false)
    const value = String(text || '').trim()
    const pending = value ? {
      id: `human:${meeting.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      phase: this.context?.cursor?.node || meeting.phase,
      text: value,
      createdAt: new Date().toISOString()
    } : null
    if (pending) this._pendingControl.push(pending)
    this.qaSkipRequested = false
    this.pauseRequested = true
    S().setMeeting({
      status: 'pausing',
      qaSkipPending: false,
      hitl: { status: 'pausing', pending: [...(this.context?.pendingInterventions || []), ...this._pendingControl] },
      checkpointError: null
    })
    this._finishDirection('__interrupt__')
    this._finishApproval('__interrupt__')
    this._abort?.abort()

    // Wait behind a checkpoint already in flight, then derive the control
    // snapshot from the newest ACKed state. Capturing `last` eagerly can make a
    // queued pause overwrite the node that just finished saving.
    const writeBarrier = this.checkpointer.waitForWrites?.() || this.checkpointer._writes || Promise.resolve()
    this._controlSave = Promise.resolve(writeBarrier).then(() => {
      const base = this.checkpointer.last
      if (!base) throw new Error('첫 전체 체크포인트가 아직 준비되지 않았습니다')
      const context = clone(base.context)
      context.pendingInterventions = [...(context.pendingInterventions || []), ...this._pendingControl]
      const snapshotMeeting = {
        ...clone(base.meeting),
        status: 'pausing',
        hitl: { status: 'pausing', pending: clone(context.pendingInterventions) }
      }
      this._freezeGateTimers(context, snapshotMeeting)
      return this.checkpointer.save({
        meetingId: meeting.id,
        status: 'pausing',
        context,
        meeting: snapshotMeeting
      })
    }).catch(async error => {
      await this._attachRemoteConflict(error, meeting.id)
      S().setMeeting({ checkpointError: String(error.message || error), status: 'paused', hitl: { status: 'error', pending: clone(this._pendingControl) } })
      throw error
    })
    return this._controlSave
  }

  async resume(text = '') {
    const meeting = S().meeting
    if (!meeting) return false
    if (meeting.status === 'pausing') {
      const value = String(text || '').trim()
      if (value) {
        const pending = {
          id: `human:${meeting.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          phase: this.context?.cursor?.node || meeting.phase,
          text: value,
          createdAt: new Date().toISOString()
        }
        this._pendingControl.push(pending)
      }
      return false
    }
    if (!['paused', 'error'].includes(meeting.status)) return false
    // Retrying resume is also how a transient checkpoint failure is recovered.
    // Keep a committed in-memory snapshot so a second failure remains safely
    // paused without consuming the human instruction twice.
    const beforeContext = clone(this.context)
    const beforeMeeting = clone(meeting)
    this._consumePendingInterventions()
    const value = String(text || '').trim()
    if (value) this._applyIntervention({
      id: `human:${meeting.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      phase: this.context.cursor.node,
      text: value,
      createdAt: new Date().toISOString()
    })
    this.pauseRequested = false
    this.cancelled = false
    this.qaSkipRequested = false
    this._seatMeeting()
    const resumingMeeting = clone(S().meeting)
    this._thawGateTimers(this.context, resumingMeeting)
    S().replaceMeeting({
      ...resumingMeeting,
      status: 'resuming',
      hitl: { status: 'resuming', pending: [] },
      checkpointError: null,
      error: null
    })
    try {
      await this._checkpoint('resuming')
      S().setMeeting({ status: 'running', hitl: { status: 'idle', pending: [] } })
      await this._checkpoint('running')
    } catch (error) {
      const remote = error?.remoteCheckpoint
      const remoteTerminal = remote && ['done', 'cancelled'].includes(remote.status)
      this.context = clone(remote?.context || beforeContext)
      S().replaceMeeting({
        ...clone(remote?.meeting || beforeMeeting),
        status: remoteTerminal ? remote.status : 'paused',
        checkpointMeta: remote ? this._checkpointMeta(remote) : beforeMeeting.checkpointMeta,
        checkpointError: error.message,
        hitl: { status: remoteTerminal ? 'idle' : 'error', pending: [] }
      })
      if (remoteTerminal) {
        this.checkpointer.clearLocal()
        this._releaseMeetingSeats()
      }
      throw error
    }
    // Control acknowledgement ends here. The workflow continues in the
    // background so the UI can offer another HITL intervention immediately.
    void this._drive().catch(() => {})
    return true
  }

  waitForIdle() {
    return this._runPromise || Promise.resolve(null)
  }

  async cancel() {
    const meeting = S().meeting
    if (!meeting || ['done', 'cancelled'].includes(meeting.status)) return false
    this.cancelled = true
    this.pauseRequested = false
    this.qaSkipRequested = false
    this._finishDirection('__cancel__')
    this._finishApproval('__cancel__')
    this._abort?.abort()
    S().setMeeting({ status: 'cancelled', approval: null, directionGate: null, qaSkipPending: false, hitl: { status: 'idle', pending: [] } })
    this._say('system', 'system', '회의를 안전하게 종료했습니다. 마지막 체크포인트와 전체 회의 기록은 보존됩니다.')
    try {
      await this._checkpoint('cancelled')
      this.checkpointer.clearLocal()
    } catch (error) {
      S().setMeeting({ checkpointError: String(error.message || error) })
    }
    this._releaseMeetingSeats()
    return true
  }

  approve() {
    if (this._approval) return this._finishApproval('confirmed')
    if (this.context?.cursor?.node === 'approval') {
      this.context.gates.approval ||= {}
      this.context.gates.approval.value = 'confirmed'
      if (S().meeting?.status === 'paused') void this.resume()
    }
  }

  chooseDirection(id) {
    if (this._direction) return this._finishDirection(id, false)
    if (this.context?.cursor?.node === 'direction') {
      this.context.gates.direction ||= {}
      this.context.gates.direction.selectedId = id
      this.context.gates.direction.auto = false
      if (S().meeting?.status === 'paused') void this.resume()
    }
  }

  async skipQa() {
    const meeting = S().meeting
    const qaNode = this.context?.cursor?.node
    const validStatus = ['running', 'resuming', 'paused', 'error'].includes(meeting?.status)
    if (!meeting || meeting.phase !== 'qa' || !['qa_test', 'qa_repair'].includes(qaNode) || !validStatus) return false
    if (this.qaSkipRequested || meeting.qaSkipPending) return true

    this.qaSkipRequested = true
    S().setMeeting({ qaSkipPending: true, qaSkippable: true })
    this._abort?.abort()

    // A restored or manually paused QA node has no in-flight atomic task to
    // abort. Commit the same explicit "unverified" transition, then resume the
    // durable workflow from release preparation.
    if (['paused', 'error'].includes(meeting.status)) {
      this._finishQaSkip()
      await this.resume()
    }
    return true
  }

  _checkpointMeta(checkpoint) {
    return {
      schemaVersion: checkpoint.schemaVersion,
      revision: checkpoint.revision,
      savedAt: checkpoint.savedAt,
      cursor: checkpoint.cursor,
      contextHash: checkpoint.contextHash
    }
  }

  _freezeGateTimers(context = this.context, meeting = S().meeting, referenceTime = Date.now()) {
    if (!context?.gates || !meeting) return meeting
    for (const [contextKey, meetingKey] of [['direction', 'directionGate'], ['approval', 'approval']]) {
      const gate = context.gates[contextKey]
      if (!gate) continue
      if (!Number.isFinite(gate.remainingMs) && Number.isFinite(gate.deadline)) {
        gate.remainingMs = Math.max(0, gate.deadline - referenceTime)
      }
      delete gate.deadline
      if (meeting[meetingKey] && Number.isFinite(gate.remainingMs)) {
        meeting[meetingKey] = { ...meeting[meetingKey], until: null, remainingMs: gate.remainingMs }
      }
    }
    return meeting
  }

  _thawGateTimers(context = this.context, meeting = S().meeting, referenceTime = Date.now()) {
    if (!context?.gates || !meeting) return meeting
    for (const [contextKey, meetingKey] of [['direction', 'directionGate'], ['approval', 'approval']]) {
      const gate = context.gates[contextKey]
      if (!gate || !Number.isFinite(gate.remainingMs)) continue
      gate.deadline = referenceTime + Math.max(0, gate.remainingMs)
      delete gate.remainingMs
      if (meeting[meetingKey]) meeting[meetingKey] = { ...meeting[meetingKey], until: gate.deadline }
    }
    return meeting
  }

  async _checkpoint(status = S().meeting?.status || 'running') {
    if (!this.context || !S().meeting?.id) return null
    this.context.artifacts = {
      prd: S().meeting.artifacts?.prd || this.context.artifacts.prd || '',
      design: S().meeting.artifacts?.design || this.context.artifacts.design || '',
      arch: S().meeting.artifacts?.arch || this.context.artifacts.arch || '',
      code: S().meeting.artifacts?.code || this.context.artifacts.code || ''
    }
    const meeting = { ...S().meeting, status, qaPreview: false }
    delete meeting.qaCode
    delete meeting.qaNonce
    let checkpoint
    try {
      checkpoint = await this.checkpointer.save({ meetingId: meeting.id, status, context: this.context, meeting })
    } catch (error) {
      await this._attachRemoteConflict(error, meeting.id)
      throw new CheckpointSaveError(error)
    }
    S().setMeeting({ checkpointMeta: this._checkpointMeta(checkpoint), checkpointError: null })
    return checkpoint
  }

  async _attachRemoteConflict(error, meetingId = S().meeting?.id) {
    if (error?.code !== 'MEETING_REVISION_CONFLICT' || !meetingId || !this.checkpointer.refreshRemote) return null
    try {
      const checkpoint = await this.checkpointer.refreshRemote(meetingId)
      if (checkpoint) error.remoteCheckpoint = checkpoint
      return checkpoint
    } catch { return null }
  }

  async _drive() {
    if (this._runPromise) return this._runPromise
    const promise = this._driveLoop()
    this._runPromise = promise
    try { return await promise } finally { if (this._runPromise === promise) this._runPromise = null }
  }

  async _driveLoop() {
    try {
      while (this.context.cursor.node !== 'done') {
        if (this.cancelled) throw new CancelSignal()
        if (this.pauseRequested) throw new PauseSignal()
        await this._runNextNode()
        if (this.cancelled) throw new CancelSignal()
        if (this.pauseRequested) throw new PauseSignal()
        if (this.context.cursor.node !== 'done') await this._checkpoint('running')
      }
      return await this._finishRun()
    } catch (error) {
      if (error instanceof PauseSignal || (this.pauseRequested && isAbortError(error))) {
        return this._enterPaused()
      }
      if (error instanceof CancelSignal || this.cancelled) return null
      if (error instanceof CheckpointSaveError) {
        const committed = error.remoteCheckpoint || this.checkpointer.last
        if (committed) {
          const terminal = ['done', 'cancelled'].includes(committed.status)
          this.context = committed.context
          S().replaceMeeting({
            ...committed.meeting,
            status: terminal ? committed.status : 'paused',
            checkpointMeta: this._checkpointMeta(committed),
            checkpointError: error.message,
            hitl: { status: terminal ? 'idle' : 'error', pending: [] }
          })
          if (terminal) {
            this.checkpointer.clearLocal()
            this._releaseMeetingSeats()
          }
        } else S().setMeeting({ status: 'paused', checkpointError: error.message, hitl: { status: 'error', pending: [] } })
        return null
      }
      const message = String(error.message || error)
      const committed = this.checkpointer.last
      if (committed) {
        this.context = clone(committed.context)
        S().replaceMeeting({
          ...clone(committed.meeting),
          checkpointMeta: this._checkpointMeta(committed)
        })
      }
      S().setMeeting({
        status: 'paused', error: message, qaPreview: false,
        hitl: { status: 'error', pending: [] }
      })
      this._say('system', 'system', `⚠️ 작업 오류로 안전하게 멈췄습니다: ${message}\n지시를 추가하거나 그대로 재시도할 수 있습니다.`)
      try { await this._checkpoint('paused') } catch (checkpointError) {
        S().setMeeting({ checkpointError: String(checkpointError.message || checkpointError) })
      }
      return null
    }
  }

  async _enterPaused() {
    let controlCheckpoint = null
    let controlError = null
    try { controlCheckpoint = await this._controlSave } catch (error) { controlError = error }
    this._controlSave = null
    if (controlCheckpoint) {
      this.context = controlCheckpoint.context
      S().replaceMeeting({ ...controlCheckpoint.meeting, checkpointMeta: this._checkpointMeta(controlCheckpoint) })
    } else if (this.checkpointer.last) {
      this.context = clone(this.checkpointer.last.context)
      S().replaceMeeting({
        ...clone(this.checkpointer.last.meeting),
        checkpointMeta: this._checkpointMeta(this.checkpointer.last)
      })
    }
    if (controlError?.remoteCheckpoint && ['done', 'cancelled'].includes(controlError.remoteCheckpoint.status)) {
      this._pendingControl = []
      this.pauseRequested = false
      S().replaceMeeting({
        ...clone(controlError.remoteCheckpoint.meeting),
        status: controlError.remoteCheckpoint.status,
        checkpointMeta: this._checkpointMeta(controlError.remoteCheckpoint),
        checkpointError: String(controlError.message || controlError),
        hitl: { status: 'idle', pending: [] }
      })
      this.checkpointer.clearLocal()
      this._releaseMeetingSeats()
      return null
    }
    const pending = this._consumePendingInterventions()
    this.pauseRequested = false
    const pausedMeeting = clone(S().meeting)
    this._freezeGateTimers(this.context, pausedMeeting)
    S().replaceMeeting({
      ...pausedMeeting,
      status: 'paused', qaPreview: false,
      hitl: { status: 'paused', pending: [] },
      checkpointError: controlError ? String(controlError.message || controlError) : null
    })
    this._say('system', 'system', pending.length
      ? '⏸️ 팀장 지시를 전체 팀 컨텍스트에 저장했습니다. 재개하면 현재 단계부터 반영합니다.'
      : '⏸️ 안전한 체크포인트에서 회의를 일시정지했습니다.')
    try { await this._checkpoint('paused') } catch (error) {
      S().setMeeting({ checkpointError: String(error.message || error), hitl: { status: 'error', pending: [] } })
    }
    return null
  }

  _consumePendingInterventions() {
    if (!this.context) return []
    const pending = [
      ...(this.context.pendingInterventions || []),
      ...this._pendingControl
    ].filter((item, index, all) => item?.id && all.findIndex(candidate => candidate.id === item.id) === index)
    this.context.pendingInterventions = []
    this._pendingControl = []
    pending.forEach(item => this._applyIntervention(item))
    return pending
  }

  _applyIntervention(item) {
    const intervention = appendHumanIntervention(this.context, item.text, item)
    if (!intervention) return
    const exists = S().meeting.transcript.some(entry => entry.interventionId === intervention.id)
    if (!exists) this._say('player', 'player', `팀장 개입: ${intervention.text}`, intervention.phase, { interventionId: intervention.id })
    S().setMeeting({ interventions: clone(this.context.interventions) })
  }

  async _atomic(label, task) {
    const beforeContext = clone(this.context)
    const beforeMeeting = clone(S().meeting)
    const qaNode = ['qa_test', 'qa_repair'].includes(beforeContext?.cursor?.node)
    const controller = new AbortController()
    this._abort = controller
    try {
      const result = await task(controller.signal)
      if (this.cancelled) throw new CancelSignal()
      if (this.pauseRequested) throw new PauseSignal()
      if (qaNode && this.qaSkipRequested) throw new QaSkipSignal()
      return result
    } catch (error) {
      if (this.cancelled || error instanceof CancelSignal) {
        this.context = beforeContext
        S().replaceMeeting({
          ...beforeMeeting,
          status: 'cancelled',
          approval: null,
          directionGate: null,
          qaPreview: false,
          hitl: { status: 'idle', pending: [] }
        })
        throw new CancelSignal()
      }
      if (this.pauseRequested && (error instanceof PauseSignal || isAbortError(error))) {
        this.context = beforeContext
        S().replaceMeeting(beforeMeeting)
        throw new PauseSignal()
      }
      if (qaNode && this.qaSkipRequested && (error instanceof QaSkipSignal || isAbortError(error))) {
        this.context = beforeContext
        S().replaceMeeting({ ...beforeMeeting, qaPreview: false, qaSkipPending: true })
        throw new QaSkipSignal()
      }
      this.context = beforeContext
      S().replaceMeeting(beforeMeeting)
      throw error
    } finally {
      if (this._abort === controller) this._abort = null
    }
  }

  async _runNextNode() {
    const node = this.context.cursor.node
    if (node === 'kickoff') return this._runKickoff()
    if (node === 'upgrade') return this._runUpgradeContext()
    if (node === 'reference') return this._runReferenceResearch()
    if (node === 'research') return this._runResearchAgent()
    if (node === 'direction') return this._runDirectionGate()
    if (node === 'concept') return this._runDebateTurn()
    if (node === 'documents') return this._runDocument()
    if (node === 'review') return this._runReviewTurn()
    if (node === 'approval') return this._runApprovalGate()
    if (node === 'implementation') return this._runImplementation()
    if (node === 'qa_test') return this._runQaTest()
    if (node === 'qa_repair') return this._runQaRepair()
    if (node === 'release_prepare') return this._prepareRelease()
    if (node === 'release_save') return this._saveRelease()
    if (node === 'release_rag') return this._saveReleaseKnowledge()
    if (node === 'release_finalize') return this._finalizeRelease()
    throw new Error(`알 수 없는 회의 실행 노드: ${node}`)
  }

  _phase(key) {
    const phase = PHASES.find(item => item.key === key)
    if (!phase) return
    const changed = S().meeting?.phase !== key
    S().setMeeting({ phase: key, phaseLabel: phase.label, bmad: phase.bmad })
    if (changed || !S().meeting.transcript.some(entry => entry.kind === 'system' && entry.phase === key && entry.phaseMarker)) {
      this._say('system', 'system', `— ${phase.label} · ${phase.bmad} —`, key, { phaseMarker: true })
    }
  }

  _say(agentId, kind, text, phase = S().meeting?.phase, extra = {}) {
    S().pushTranscript({ agentId, kind, phase, text, ...extra })
  }

  _updateResearch(agentId, patch) {
    const research = S().meeting?.research
    if (!research) return
    S().setMeeting({
      research: {
        ...research,
        members: {
          ...research.members,
          [agentId]: { ...(research.members?.[agentId] || {}), ...patch }
        }
      }
    })
  }

  _updateReference(patch) {
    const research = S().meeting?.research
    if (!research) return
    S().setMeeting({ research: { ...research, reference: { ...(research.reference || {}), ...patch } } })
  }

  _sharedContext() {
    const transcript = (S().meeting?.transcript || [])
      .filter(entry => ['talk', 'player', 'doc', 'note', 'qa'].includes(entry.kind) && !entry.interventionId)
      .map(entry => {
        const name = entry.agentId === 'player'
          ? `${PLAYER.name}(팀장)`
          : (TEAM.find(member => member.id === entry.agentId)?.name || entry.agentId)
        return `${name}: ${entry.text}`
      }).join('\n')
    return `[지금까지의 전체 회의 트랜스크립트]\n${transcript}`
  }

  _messagesFor(member, prompt) {
    const history = (this.context.agents?.[member.id]?.messages || []).map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      text: message.kind === 'human-intervention'
        ? `[팀장 실시간 개입] ${message.text}`
        : message.text
    }))
    return [...history, {
      role: 'user',
      text: prompt
    }]
  }

  async _generate(member, { prompt, phase, hint, model = 'fast', search = false, signal, kind = 'talk', turnId }) {
    const out = await this.api.generate({
      system: personaSystem(member, S().games),
      messages: this._messagesFor(member, prompt),
      hint, model, search,
      personaMeta: { name: member.name, idx: TEAM.indexOf(member) }
    }, { signal })
    recordAgentExchange(this.context, member.id, {
      phase, kind, input: prompt, output: out.text, sources: out.sources || [], turnId
    })
    return out
  }

  async _streamTurn(member, {
    prompt,
    phase,
    hint,
    model = 'fast',
    search = false,
    kind = 'talk',
    bubble = true,
    signal,
    turnId
  }) {
    this.world?.emote?.(member.id, true)
    let accumulated = ''
    S().pushTranscript({ agentId: member.id, kind, text: '', phase, turnId })
    try {
      const out = await this.api.stream({
        system: personaSystem(member, S().games),
        messages: this._messagesFor(member, prompt),
        hint, model, search,
        personaMeta: { name: member.name, idx: TEAM.indexOf(member) }
      }, (delta, full) => {
        accumulated = full
        S().pushTranscript({ agentId: member.id, kind, text: delta, append: true, phase, turnId })
        if (bubble) this.world?.bubble?.(member.id, full.slice(-52), 3000)
      }, { signal })
      accumulated = out.text || accumulated
      recordAgentExchange(this.context, member.id, {
        phase, kind, input: prompt, output: accumulated, sources: out.sources || [], turnId
      })
      if (out.sources?.length) this._say(member.id, 'source', out.sources.map(source => `🔗 ${source.title || source.uri}`).join('\n'), phase)
      return { ...out, text: accumulated }
    } finally {
      this.world?.emote?.(member.id, false)
      if (bubble && accumulated) this.world?.bubble?.(member.id, accumulated.slice(-60), 2600)
    }
  }

  async _runKickoff() {
    this._phase('kickoff')
    const { agenda, upgradeGame } = this.context.input
    this._say('player', 'player', `오늘 안건입니다: "${agenda}"${upgradeGame ? ` — ${upgradeGame.title} ${upgradeGame.version} 업그레이드 회의입니다.` : ' — 신규 게임 제작 회의입니다.'} 각자 조사부터 시작해 주세요.`)
    this.world?.bubble?.('player', agenda, 4200)
    await this.sleep(350)
    this.context.cursor.node = 'upgrade'
  }

  async _runUpgradeContext() {
    const game = this.context.input.upgradeGame
    if (game && !this.context.upgrade.currentCode) {
      await this._atomic('upgrade-bundle', async signal => {
        const bundle = await this.api.bundle(game.id, undefined, { signal })
        const feedback = game.feedback?.[game.version]
        this.context.upgrade.currentCode = bundle.code || ''
        this.context.upgrade.info = `현재 버전: ${game.version}\n최근 오락실 평균: ${feedback?.avg ?? '없음'}\n피드백 요약: ${(feedback?.summary || '없음').slice(0, 800)}`
      })
    }
    this.context.cursor.node = 'reference'
  }

  async _runReferenceResearch() {
    this._phase('research')
    if (!this.context.input.referenceSearch) {
      this.context.cursor.node = 'research'
      return
    }
    if (!this.context.research.referenceResult) {
      await this._atomic('reference-research', async signal => {
        this._say('system', 'system', '🎯 레퍼런스 탐색 시작 — 기획에서 검색어를 뽑고 후보 게임과 UI 화면을 병렬 조사합니다.')
        TEAM.filter(member => ['writer', 'designer'].includes(member.id))
          .forEach(member => this.world?.bubble?.(member.id, '🎯 레퍼런스 스캔 중...', 8000))
        let result
        try {
          result = await this.api.referenceResearch({
            agenda: this.context.input.agenda,
            currentInfo: this.context.upgrade.info,
            preferredTarget: this.context.input.referenceTarget
          }, progress => this._updateReference({ enabled: true, ...progress, error: null }), { signal })
        } catch (error) {
          if (this.pauseRequested && isAbortError(error)) throw error
          result = localReferenceFallback(this.context.input.agenda, error)
        }
        const referenceContext = formatReferenceBrief(result)
        const designContract = normalizeReferenceDesignContract(result)
        this.context.research.referenceResult = result
        this.context.research.referenceContext = referenceContext
        this.context.research.referenceDesignContract = designContract
        this.context.research.corpus.push(referenceContext)
        this._updateReference({
          enabled: true,
          ...result,
          ...(designContract ? {
            contractId: designContract.contractId,
            designContract,
            contractStatus: { stage: 'planned', attempt: 0, issues: [] }
          } : {})
        })
        const target = result.selected
        const verified = (result.uiReferences || []).filter(item => item.verified).length
        this._say('system', 'system', target
          ? `✅ 최종 레퍼런스 타겟: ${target.title}\n선정 이유: ${result.reason || target.why}\nUI 레퍼런스 ${result.uiReferences?.length || 0}건 (${verified}건 검색 검증) — 정보 구조와 피드백 패턴만 차용합니다.`
          : '⚠️ 레퍼런스 타겟을 확정하지 못해 일반 게임 UI 원칙으로 진행합니다.')
        const links = (result.uiReferences || []).filter(item => item.url).slice(0, 5)
        if (links.length) this._say('system', 'source', links.map(item => `🔗 ${item.title}: ${item.url}`).join('\n'))
      })
    }
    this.context.cursor.node = 'research'
  }

  async _runResearchAgent() {
    this._phase('research')
    const index = this.context.cursor.researchAgentIndex || 0
    const member = TEAM[index]
    if (!member) {
      const keywords = extractKeywords(`${this.context.input.agenda}\n${this.context.research.corpus.join('\n')}`, 7)
      this.context.research.result = { status: 'done', keywords }
      S().setMeeting({ research: { ...S().meeting.research, status: 'done', keywords } })
      this.context.cursor.node = 'direction'
      return
    }
    await this._atomic(`research:${member.id}`, async signal => {
      this.world?.bubble?.(member.id, '🔍 조사 중...', 6000)
      const query = await this.api.ragQuery(`${this.context.input.agenda} ${member.role} 관점`, 3)
      if (this.pauseRequested) throw new PauseSignal()
      const ragNotes = (query.results || []).map(result => `- (${result.kind}) ${result.text.slice(0, 160)}`).join('\n')
      const agent = this.context.agents[member.id]
      agent.research.ragNotes = ragNotes
      agent.research.ragResults = clone(query.results || [])
      this._updateResearch(member.id, { rag: 'done', ragHits: (query.results || []).length })
      if (ragNotes) this.context.research.corpus.push(ragNotes)

      const wantsSearch = ['writer', 'pm', 'designer'].includes(member.id)
      let webNotes = ''
      let webSources = []
      if (wantsSearch && S().config.webSearch) {
        try {
          const searchResult = await this.api.search(`${this.context.input.agenda} 게임 트렌드 ${member.role}`.slice(0, 300), 4, { signal })
          webSources = (searchResult.results || []).map(result => ({ title: result.title, uri: result.url }))
          webNotes = (searchResult.answer ? `요약: ${searchResult.answer}\n` : '') +
            (searchResult.results || []).map(result => `- ${result.title}: ${String(result.content || '').slice(0, 200)} (${result.url})`).join('\n')
          agent.research.webNotes = webNotes
          agent.research.sources = clone(webSources)
          this._updateResearch(member.id, { web: 'done', webHits: (searchResult.results || []).length })
          this.context.research.corpus.push(searchResult.answer || '', ...(searchResult.results || []).map(result => `${result.title} ${result.content || ''}`))
        } catch (error) {
          if (this.pauseRequested && isAbortError(error)) throw error
          this._updateResearch(member.id, { web: 'fallback', webHits: 0 })
        }
      }
      const useSearch = !webNotes && S().config.llm === 'live' && wantsSearch
      try {
        const prompt = P.research(
          this.context.input.agenda,
          ragNotes,
          !!this.context.input.upgradeGame,
          this.context.upgrade.info,
          webNotes,
          this.context.research.referenceContext,
          this.context.research.referenceDesignContract
        )
        const out = await this._generate(member, {
          prompt, phase: 'research', hint: 'research', model: 'fast', search: useSearch, signal,
          kind: 'note', turnId: `research:${member.id}`
        })
        agent.note = out.text
        this.context.research.corpus.push(out.text)
        this._updateResearch(member.id, { note: 'done', ...(useSearch ? { web: 'done', webHits: (out.sources || []).length } : {}) })
        const allSources = [...webSources, ...(out.sources || [])].slice(0, 6)
        this._say(member.id, 'note', out.text + (allSources.length ? `\n${allSources.map(source => `🔗 ${source.title || source.uri}`).join('\n')}` : ''), 'research')
        this.world?.bubble?.(member.id, `조사 완료! ${out.text.slice(0, 30)}`, 3000)
      } catch (error) {
        if (this.pauseRequested && isAbortError(error)) throw error
        agent.note = ''
        this._updateResearch(member.id, { note: 'error' })
        this._say('system', 'system', `${member.name} 조사 실패: ${error.message}`, 'research')
      }
    })
    this.context.cursor.researchAgentIndex = index + 1
    if (this.context.cursor.researchAgentIndex >= TEAM.length) {
      const keywords = extractKeywords(`${this.context.input.agenda}\n${this.context.research.corpus.join('\n')}`, 7)
      this.context.research.result = { status: 'done', keywords }
      S().setMeeting({ research: { ...S().meeting.research, status: 'done', keywords } })
      this.context.cursor.node = 'direction'
    }
  }

  async _runDirectionGate() {
    const research = this.context.research.result || { keywords: [] }
    let gate = this.context.gates.direction
    if (!gate?.options?.length) {
      const options = buildDirections({
        agenda: this.context.input.agenda,
        keywords: research.keywords || [],
        isUpgrade: !!this.context.input.upgradeGame,
        upgradeInfo: this.context.upgrade.info
      })
      const recommended = options.find(option => option.recommended) || options[0]
      gate = this.context.gates.direction = {
        options,
        recommendedId: recommended.id,
        selectedId: null,
        auto: false,
        deadline: Date.now() + 12000
      }
    }
    S().setMeeting({
      directionGate: { options: gate.options, recommendedId: gate.recommendedId, until: gate.deadline }
    })
    if (!gate.announced) {
      this._say('system', 'system', '🧭 리서치 완료 — 이번 빌드의 제작 방향을 고르세요. 12초 후 추천안으로 진행합니다.')
      gate.announced = true
    }
    await this._checkpoint('running')
    if (this.cancelled) throw new CancelSignal()
    if (this.pauseRequested) throw new PauseSignal()
    let selection = gate.selectedId ? { id: gate.selectedId, auto: !!gate.auto } : null
    if (!selection) {
      selection = await new Promise(resolve => {
        const remaining = Math.max(0, gate.deadline - Date.now())
        const timer = setTimeout(() => this._finishDirection(gate.recommendedId, true), remaining)
        this._direction = { resolve, timer }
      })
      this._direction = null
    }
    if (selection.id === '__interrupt__') throw new PauseSignal()
    if (selection.id === '__cancel__') throw new CancelSignal()
    const picked = gate.options.find(option => option.id === selection.id) || gate.options.find(option => option.id === gate.recommendedId) || gate.options[0]
    const direction = {
      ...picked,
      mission: { ...picked.mission, id: `${S().meeting.id}:${picked.id}` },
      selectedAt: Date.now(),
      autoSelected: selection.auto
    }
    this.context.direction = direction
    this.context.gates.direction = null
    S().setMeeting({ directionGate: null, direction })
    this._say('player', 'player', `${direction.icon} 제작 방향은 「${direction.title}」로 갑니다. 이번 빌드 KPI: ${direction.mission.label}`)
    this.context.cursor.node = 'concept'
    this.context.cursor.debateRound = 1
    this.context.cursor.debateAgentIndex = 0
  }

  _finishDirection(id, auto = false) {
    if (!this._direction) return
    clearTimeout(this._direction.timer)
    const { resolve } = this._direction
    this._direction = null
    resolve({ id, auto })
  }

  async _runDebateTurn() {
    this._phase('concept')
    const order = ['writer', 'designer', 'dev1', 'dev2', 'pm']
    const round = this.context.cursor.debateRound || 1
    const index = this.context.cursor.debateAgentIndex || 0
    const memberId = order[index]
    const member = TEAM.find(candidate => candidate.id === memberId)
    const rounds = this.context.input.upgradeGame ? 1 : 2
    if (!member || round > rounds) {
      this.context.cursor.node = 'documents'
      this.context.cursor.documentIndex = 0
      return
    }
    await this._atomic(`debate:${round}:${member.id}`, async signal => {
      const prompt = `${this._sharedContext()}\n\n${P.debate(
        this.context.input.agenda,
        round,
        this.context.agents[member.id].note,
        this.context.direction,
        this.context.research.referenceContext,
        this.context.research.referenceDesignContract
      )}`
      await this._streamTurn(member, {
        prompt, phase: 'concept', hint: 'debate', signal,
        turnId: `debate:${round}:${member.id}`
      })
    })
    this.context.cursor.debateAgentIndex = index + 1
    if (this.context.cursor.debateAgentIndex >= order.length) {
      this.context.cursor.debateAgentIndex = 0
      this.context.cursor.debateRound = round + 1
    }
    if (this.context.cursor.debateRound > rounds) {
      this.context.cursor.node = 'documents'
      this.context.cursor.documentIndex = 0
    }
    await this.sleep(100)
  }

  async _runDocument() {
    const specs = [
      { key: 'prd', id: 'pm', hint: 'prd', model: 'smart' },
      { key: 'design', id: 'designer', hint: 'design', model: 'fast' },
      { key: 'arch', id: 'dev1', hint: 'arch', model: 'fast' }
    ]
    const index = this.context.cursor.documentIndex || 0
    const spec = specs[index]
    if (!spec) {
      this.context.cursor.node = 'review'
      this.context.cursor.reviewAgentIndex = 0
      return
    }
    this._phase(spec.key)
    const member = TEAM.find(candidate => candidate.id === spec.id)
    await this._atomic(`document:${spec.key}`, async signal => {
      this.world?.bubble?.(member.id, `📝 ${spec.key === 'prd' ? 'PRD' : spec.key === 'design' ? '아트/UX 스펙' : '기술 설계'} 작성 중...`, 8000)
      const docs = this.context.artifacts
      const body = spec.key === 'prd'
        ? P.prd(this.context.input.agenda, this.context.direction, this.context.research.referenceContext, this.context.research.referenceDesignContract)
        : spec.key === 'design'
          ? P.design(this.context.direction, this.context.research.referenceContext, this.context.research.referenceDesignContract, docs.prd)
          : P.arch(this.context.direction, this.context.research.referenceContext, this.context.research.referenceDesignContract, docs.prd, docs.design)
      const prompt = `${this._sharedContext()}\n\n${body}${this.context.input.upgradeGame ? '\n(업그레이드이므로 기존 대비 바뀌는 부분을 중심으로)' : ''}`
      const out = await this._streamTurn(member, {
        prompt, phase: spec.key, hint: spec.hint, kind: 'doc', model: spec.model,
        bubble: false, signal, turnId: `document:${spec.key}`
      })
      this.context.artifacts[spec.key] = out.text
      S().setMeeting({ artifacts: { ...S().meeting.artifacts, [spec.key]: out.text } })
    })
    this.context.cursor.documentIndex = index + 1
    if (this.context.cursor.documentIndex >= specs.length) {
      this.context.cursor.node = 'review'
      this.context.cursor.reviewAgentIndex = 0
    }
  }

  async _runReviewTurn() {
    this._phase('review')
    const order = ['dev2', 'writer']
    const index = this.context.cursor.reviewAgentIndex || 0
    const member = TEAM.find(candidate => candidate.id === order[index])
    if (!member) {
      this.context.cursor.node = 'approval'
      return
    }
    await this._atomic(`review:${member.id}`, async signal => {
      const prompt = `${this._sharedContext()}\n\n${P.review(this.context.research.referenceDesignContract)}`
      await this._streamTurn(member, {
        prompt, phase: 'review', hint: 'review', signal,
        turnId: `review:${member.id}`
      })
    })
    this.context.cursor.reviewAgentIndex = index + 1
    if (this.context.cursor.reviewAgentIndex >= order.length) this.context.cursor.node = 'approval'
  }

  async _runApprovalGate() {
    this._phase('review')
    const auto = !!S().settings.autoApprove
    let gate = this.context.gates.approval
    if (!gate) {
      gate = this.context.gates.approval = {
        auto,
        value: null,
        deadline: Date.now() + (auto ? 6000 : 90000)
      }
    }
    S().setMeeting({ approval: { until: gate.deadline, auto: gate.auto } })
    await this._checkpoint('running')
    if (this.cancelled) throw new CancelSignal()
    if (this.pauseRequested) throw new PauseSignal()
    let value = gate.value
    if (!value) {
      value = await new Promise(resolve => {
        const remaining = Math.max(0, gate.deadline - Date.now())
        const timer = setTimeout(() => this._finishApproval('auto'), remaining)
        this._approval = { resolve, timer }
      })
      this._approval = null
    }
    if (value === '__interrupt__') throw new PauseSignal()
    if (value === '__cancel__') throw new CancelSignal()
    this.context.gates.approval = null
    S().setMeeting({ approval: null })
    this._say('system', 'system', value === 'auto'
      ? '출시 준비 자동 확인 — 구현 단계로 진행합니다.'
      : '팀장이 출시 준비를 확인했습니다. 구현을 시작합니다.')
    this.context.cursor.node = 'implementation'
  }

  _finishApproval(value) {
    if (!this._approval) return
    clearTimeout(this._approval.timer)
    const { resolve } = this._approval
    this._approval = null
    resolve(value)
  }

  async _runImplementation() {
    this._phase('impl')
    const developer = TEAM.find(member => member.id === 'dev2')
    await this._atomic('implementation', async signal => {
      this.world?.bubble?.(developer.id, '💻 코딩 존 들어갑니다...', 6000)
      this._say(developer.id, 'talk', '구현 시작합니다. 계약(게임팩 API) 준수해서 작성할게요.')
      const progressId = 'implementation:progress'
      S().pushTranscript({ agentId: developer.id, kind: 'progress', text: '⌨️ 코드 작성 중... 0자', phase: 'impl', turnId: progressId })
      const upgradeContext = this.context.input.upgradeGame
        ? `\n[기존 코드 — 이 코드를 개선하세요]\n\`\`\`js\n${this.context.upgrade.currentCode.slice(0, 16000)}\n\`\`\`\n[유저 피드백 반영사항]\n${this.context.upgrade.info}`
        : ''
      const prompt = P.impl(
        this.context.input.agenda,
        this.context.artifacts.prd,
        this.context.artifacts.design,
        this.context.artifacts.arch,
        upgradeContext,
        this.context.direction,
        this.context.research.referenceContext,
        this.context.research.referenceDesignContract
      )
      let accumulated = ''
      const out = await this.api.stream({
        system: personaSystem(developer, S().games),
        messages: this._messagesFor(developer, prompt),
        hint: 'code', model: 'smart', personaMeta: { name: developer.name }
      }, (delta, full) => {
        accumulated = full
        const transcript = [...S().meeting.transcript]
        const progressIndex = transcript.findIndex(entry => entry.turnId === progressId)
        if (progressIndex >= 0) transcript[progressIndex] = { ...transcript[progressIndex], text: `⌨️ 코드 작성 중... ${full.length.toLocaleString()}자` }
        S().setMeeting({ transcript })
        if (full.length % 400 < 24) this.world?.bubble?.(developer.id, `⌨️ ${full.length}자...`, 1500)
      }, { signal })
      accumulated = out.text || accumulated
      const code = extractCode(accumulated)
      recordAgentExchange(this.context, developer.id, {
        phase: 'impl', kind: 'code', input: prompt, output: accumulated,
        sources: out.sources || [], turnId: 'implementation'
      })
      this.context.artifacts.code = code
      S().setMeeting({ artifacts: { ...S().meeting.artifacts, code } })
      this._say(developer.id, 'talk', `구현 완료! ${code.split('\n').length}줄입니다. QA 돌려주세요.`)
      if (this.context.research.referenceDesignContract) {
        this._updateReference({
          contractStatus: { stage: 'implemented', attempt: 0, issues: [], ...this._referenceTrace(code) }
        })
      }
    })
    this.context.cursor.node = 'qa_test'
    this.context.cursor.qaAttempt = this.context.qa.attempt || 0
  }

  _referenceTrace(code = this.context.artifacts.code) {
    const contract = this.context.research.referenceDesignContract
    if (!contract) return {}
    return {
      screens: contract.qa.requiredScreens.filter(id => code.includes(id)),
      implementedPatterns: contract.qa.requiredPatternIds.filter(id => code.includes(id)),
      implementedStates: contract.qa.requiredStates.filter(id => code.includes(id)),
      depthSignals: contract.qa.depthSignals.map(signal => signal.id).filter(id => code.includes(id)),
      feedbackSignals: contract.qa.feedbackSignals.map(signal => signal.id).filter(id => code.includes(id))
    }
  }

  async _qaPreviewMount(signal) {
    if (typeof document === 'undefined') return null
    const nextFrame = () => new Promise(resolve => {
      if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(resolve)
      else globalThis.setTimeout(resolve, 0)
    })
    // Zustand updates immediately, while React may need a paint to switch back
    // to the transcript tab and commit the enlarged preview slot.
    for (let frame = 0; frame < 4; frame++) {
      if (signal?.aborted) throw abortError('QA preview mount aborted')
      const mount = document.getElementById('qa-preview-slot')
      if (mount) return mount
      await nextFrame()
    }
    if (signal?.aborted) throw abortError('QA preview mount aborted')
    return document.getElementById('qa-preview-slot')
  }

  _finishQaSkip() {
    const qaMember = TEAM.find(member => member.id === 'dev1')
    const attempt = (this.context.qa.attempt || 0) + 1
    const skippedAt = new Date().toISOString()
    const diagnostics = {
      ...(this.context.qa.diagnostics || {}),
      skipped: true,
      reason: 'user-fast-release',
      message: '팀장 선택으로 자동 QA를 건너뜀'
    }
    const alreadyRecorded = this.context.qa.history.some(item => item.skipped)
    this.context.qa.pass = false
    this.context.qa.skipped = true
    this.context.qa.skippedAt = skippedAt
    this.context.qa.diagnostics = diagnostics
    if (!alreadyRecorded) {
      this.context.qa.history.push({
        attempt,
        pass: false,
        skipped: true,
        skippedAt,
        diagnostics: clone(diagnostics),
        codeHash: this._codeHash(this.context.artifacts.code)
      })
    }
    if (this.context.research.referenceDesignContract) {
      this._updateReference({
        contractStatus: {
          stage: 'unstable',
          attempt,
          issues: ['팀장 선택으로 자동 QA를 건너뜀'],
          ...this._referenceTrace()
        }
      })
    }
    this.context.cursor.node = 'release_prepare'
    this.context.cursor.qaAttempt = this.context.qa.attempt || 0
    this.qaSkipRequested = false
    S().setMeeting({
      qaPreview: false,
      qaSkippable: false,
      qaSkipPending: false,
      qaSkipped: true,
      qaActivity: null
    })
    if (!S().meeting.transcript.some(entry => entry.qaSkipped)) {
      this._say(
        qaMember?.id || 'system',
        'qa',
        '⚡ 팀장 선택으로 자동 QA를 건너뜁니다. QA 미검증 상태를 명시하고 빠른 릴리즈 준비로 이동합니다.',
        'qa',
        { qaSkipped: true }
      )
    }
    S().toast('⚡ QA를 건너뛰고 빠른 배포를 준비합니다.', 'warn')
  }

  async _runQaTest() {
    this._phase('qa')
    S().setMeeting({ qaSkippable: true, qaActivity: 'testing' })
    if (this.qaSkipRequested) return this._finishQaSkip()
    const qaMember = TEAM.find(member => member.id === 'dev1')
    const contract = this.context.research.referenceDesignContract
    const code = this.context.artifacts.code
    const collectionVisual = /포켓몬|몬스터|생물\s*수집|캐릭터\s*수집|도감|creature\s*collection|monster\s*collection/i
      .test(`${this.context.input.agenda}\n${this.context.artifacts.prd}`)
    const requiredScreens = visualQaRequiredScreens(contract, { collectionFallback: collectionVisual })
    const attempt = this.context.qa.attempt || 0
    let outcome
    try {
      outcome = await this._atomic(`qa:${attempt + 1}`, async signal => {
        if (contract) this._updateReference({
          contractStatus: { stage: 'testing', attempt: attempt + 1, issues: [], ...this._referenceTrace(code) }
        })
        this.world?.bubble?.(qaMember.id, `🧪 스모크 테스트 ${attempt + 1}차...`, 5000)
        this._say(qaMember.id, 'qa', `자동 QA ${attempt + 1}차 실행 — 샌드박스에서 봇 플레이 테스트 중...`)
        S().setMeeting({ qaPreview: true, qaCode: code, qaNonce: Date.now() })
        const mountEl = await this._qaPreviewMount(signal)
        try {
          return await this.smokeTest(code, {
            mountEl, durationMs: 9000, strictVisual: true,
            requiredScreens, designContract: contract, signal
          })
        } finally { S().setMeeting({ qaPreview: false }) }
      })
    } catch (error) {
      if (error instanceof QaSkipSignal) return this._finishQaSkip()
      throw error
    }
    const diagnostics = clone(outcome?.diagnostics || {})
    this.context.qa.diagnostics = diagnostics
    this.context.qa.pass = !!outcome?.pass
    this.context.qa.history.push({ attempt: attempt + 1, pass: !!outcome?.pass, diagnostics, codeHash: this._codeHash(code) })
    if (contract) {
      const referenceQa = diagnostics.visual?.reference || diagnostics.reference || diagnostics.designContract || {}
      this._updateReference({
        contractStatus: {
          stage: outcome.pass ? 'verified' : (attempt < 2 ? 'repairing' : 'unstable'),
          attempt: attempt + 1,
          qa: referenceQa,
          issues: diagnostics.visual?.issues || referenceQa.missing || referenceQa.issues || [],
          ...this._referenceTrace(code)
        }
      })
    }
    if (outcome.pass) {
      this._say(qaMember.id, 'qa', `✅ QA 통과 — 봇 플레이 점수 ${diagnostics.score}, 오류 0건, 2.5D${contract ? '·레퍼런스 디자인 계약' : ' 비주얼 계약'} 충족.`)
      this.context.cursor.node = 'release_prepare'
      S().setMeeting({ qaSkippable: false, qaActivity: null })
      return
    }
    const failure = diagnostics.fatal || diagnostics.errors?.[0] || diagnostics.visual?.missing?.[0] ||
      (!diagnostics.scoreChanged && !diagnostics.overFired ? '봇 입력에 게임이 반응하지 않음' : '화면 렌더 없음')
    this._say(qaMember.id, 'qa', `❌ QA 실패: ${failure}${attempt < 2 ? ' → 수리 요청' : ''}`)
    if (attempt >= 2) {
      this._say(qaMember.id, 'qa', `⚠️ QA 미통과 상태로 릴리즈합니다 (진단: ${JSON.stringify(diagnostics).slice(0, 200)}). 다음 버전에서 개선 필요.`)
      this.context.cursor.node = 'release_prepare'
      S().setMeeting({ qaSkippable: false, qaActivity: null })
    } else {
      this.context.cursor.node = 'qa_repair'
      S().setMeeting({ qaActivity: 'repairing' })
    }
  }

  async _runQaRepair() {
    this._phase('qa')
    S().setMeeting({ qaSkippable: true, qaActivity: 'repairing' })
    if (this.qaSkipRequested) return this._finishQaSkip()
    const developer = TEAM.find(member => member.id === 'dev2')
    const attempt = this.context.qa.attempt || 0
    try {
      await this._atomic(`repair:${attempt + 1}`, async signal => {
        this.world?.bubble?.(developer.id, '🔧 버그 수정 중...', 6000)
        const prompt = P.repair(
          this.context.artifacts.code,
          this.context.qa.diagnostics,
          this.context.research.referenceDesignContract,
          this.context.input.agenda
        )
        const out = await this._generate(developer, {
          prompt, phase: 'qa', hint: 'repair', model: 'smart', signal,
          kind: 'code', turnId: `repair:${attempt + 1}`
        })
        const code = extractCode(out.text)
        this.context.artifacts.code = code
        S().setMeeting({ artifacts: { ...S().meeting.artifacts, code } })
        this._say(developer.id, 'talk', '수정본 나왔습니다. 다시 테스트 부탁해요.', 'qa')
      })
    } catch (error) {
      if (error instanceof QaSkipSignal) return this._finishQaSkip()
      throw error
    }
    this.context.qa.attempt = attempt + 1
    this.context.cursor.qaAttempt = this.context.qa.attempt
    this.context.cursor.node = 'qa_test'
    S().setMeeting({ qaActivity: 'testing' })
  }

  async _prepareRelease() {
    this._phase('release')
    const pm = TEAM.find(member => member.id === 'pm')
    await this._atomic('release:prepare', async signal => {
      const code = this.context.artifacts.code
      const meta = this._parseMeta(
        this.context.artifacts.prd,
        this.context.input.agenda,
        code,
        this.context.input.upgradeGame
      )
      const version = this.context.input.upgradeGame
        ? bumpVersion(this.context.input.upgradeGame.version)
        : 'v1.0.0'
      const changelogPrompt = `${this._sharedContext()}\n\n${P.changelog(meta.title, version, !!this.context.input.upgradeGame)}`
      const changelog = await this._generate(pm, {
        prompt: changelogPrompt, phase: 'release', hint: 'changelog', model: 'fast', signal,
        kind: 'doc', turnId: 'release:changelog'
      })
      const now = new Date().toISOString().slice(0, 10)
      const changelogEntry = `## ${version} (${now})\n${changelog.text.trim()}\n`
      let previousChangelog = ''
      if (this.context.input.upgradeGame) {
        const response = await this.api.files(this.context.input.upgradeGame.id)
        if (this.pauseRequested) throw new PauseSignal()
        previousChangelog = (response.files?.['CHANGELOG.md'] || '').replace(/^# Changelog\n+/, '')
      }
      const contract = this.context.research.referenceDesignContract
      const referenceResult = this.context.research.referenceResult
      const referenceBlueprint = referenceResult?.blueprint || referenceResult?.designContract || contract
      const referenceSummary = contract ? {
        contractId: contract.contractId,
        targetId: contract.targetId,
        targetTitle: contract.targetTitle,
        requiredScreens: contract.qa.requiredScreens,
        requiredPatternIds: contract.qa.requiredPatternIds,
        ...this._referenceTrace(code),
        contractStatus: clone(S().meeting.research?.reference?.contractStatus || {})
      } : null
      const files = {
        'game.js': code,
        'meta.json': JSON.stringify({
          id: meta.id, title: meta.title, desc: meta.desc, genre: meta.genre,
          controls: meta.controls, emoji: meta.emoji, color: meta.color,
          qa: this.context.qa.pass ? 'pass' : 'unstable',
          qaSkipped: !!this.context.qa.skipped,
          ...(referenceSummary ? { reference: referenceSummary } : {})
        }, null, 2),
        'README.md': `# ${meta.emoji} ${meta.title}\n\n${meta.desc}\n\n- 장르: ${meta.genre}\n- 조작: ${meta.controls.join(', ')}\n- 제작: DOTCADE 스튜디오 (BMAD 멀티에이전트 회의)\n- 안건: ${this.context.input.agenda}\n`,
        'docs/prd.md': this.context.artifacts.prd,
        'docs/design.md': this.context.artifacts.design,
        'docs/architecture.md': this.context.artifacts.arch,
        ...(referenceResult ? { 'docs/reference-research.md': referenceMarkdown(referenceResult) } : {}),
        ...(referenceBlueprint ? {
          'docs/reference-blueprint.json': JSON.stringify(referenceBlueprint, null, 2),
          'docs/reference-implementation.md': referenceImplementationMarkdown(contract, {
            code,
            docs: this.context.artifacts,
            qaResult: { pass: this.context.qa.pass, diagnostics: this.context.qa.diagnostics }
          })
        } : {}),
        'CHANGELOG.md': this.context.input.upgradeGame
          ? `# Changelog\n\n${changelogEntry}\n${previousChangelog}`
          : `# Changelog\n\n${changelogEntry}`
      }
      this.context.release = {
        meta, version, files, changelogText: changelog.text.trim(), changelogEntry,
        idempotencyKey: `${S().meeting.id}:release:${version}`,
        preparedAt: new Date().toISOString()
      }
    })
    this.context.cursor.node = 'release_save'
    this.context.cursor.releaseStep = 'save'
  }

  async _saveRelease() {
    const release = this.context.release
    if (!release) throw new Error('릴리즈 준비 체크포인트가 없습니다')
    if (!this.context.effects.gameSaved) {
      let saved
      if (this.context.input.upgradeGame) {
        saved = await this.api.addVersion(this.context.input.upgradeGame.id, {
          files: release.files,
          message: `${release.meta.title} ${release.version} — ${this.context.input.agenda}`.slice(0, 100),
          version: release.version,
          meetingId: S().meeting.id,
          idempotencyKey: release.idempotencyKey
        })
      } else {
        try {
          saved = await this.api.createGame({
            ...release.meta,
            files: release.files,
            message: `${release.meta.title} ${release.version} — ${this.context.input.agenda}`.slice(0, 100),
            meetingId: S().meeting.id,
            idempotencyKey: release.idempotencyKey
          })
        } catch (error) {
          if (!/이미 존재|HTTP 409|idempot/i.test(String(error.message || error))) throw error
          saved = await this.api.game(release.meta.id)
        }
      }
      this.context.effects.gameSaved = clone(saved.game)
    }
    const game = this.context.effects.gameSaved
    if (!S().meeting.transcript.some(entry => entry.releaseSaved)) {
      this._say('system', 'system', `🎉 ${game.emoji} 「${game.title}」 ${release.version} 릴리즈! 게임팩이 진열대에 추가되었습니다.`, 'release', { releaseSaved: true })
      this._say('pm', 'talk', `릴리즈 노트:\n${release.changelogText}`, 'release')
      TEAM.forEach(member => this.world?.bubble?.(member.id, pickCheer(member.id), 4200))
    }
    this.context.cursor.node = 'release_rag'
    this.context.cursor.releaseStep = 'knowledge'
  }

  async _saveReleaseKnowledge() {
    const game = this.context.effects.gameSaved
    const release = this.context.release
    if (!game || !release) throw new Error('저장된 릴리즈 컨텍스트가 없습니다')
    if (!this.context.effects.ragSaved) {
      await this.api.ragUpsert([
        {
          id: `prd-${game.id}-${release.version}`,
          kind: 'prd', gameId: game.id,
          text: `${game.title} ${release.version} PRD: ${this.context.artifacts.prd}`
        },
        {
          id: `meeting-${S().meeting.id}`,
          kind: 'meeting', gameId: game.id,
          text: `${this.context.input.agenda} 회의 전체 결론:\n${this.context.artifacts.prd}`
        },
        ...(this.context.research.referenceResult ? [{
          id: `reference-${game.id}-${release.version}`,
          kind: 'ui-reference', gameId: game.id,
          text: `${game.title} ${release.version} 제작 레퍼런스:\n${this.context.research.referenceContext}`
        }] : [])
      ])
      this.context.effects.ragSaved = true
    }
    this.context.cursor.node = 'release_finalize'
    this.context.cursor.releaseStep = 'finalize'
  }

  async _finalizeRelease() {
    const game = this.context.effects.gameSaved
    const release = this.context.release
    const gamesResponse = await this.api.games()
    S().setGames(gamesResponse.games)
    this.world?.setShelfGames?.(gamesResponse.games)
    let reward = S().meeting.reward || null
    if (!this.context.effects.rewardApplied) {
      reward = S().awardRelease({
        releaseId: S().meeting.id,
        title: game.title,
        version: release.version,
        gameId: game.id,
        qaOk: !!this.context.qa.pass,
        upgrade: !!this.context.input.upgradeGame,
        directionId: this.context.direction?.id,
        mission: this.context.direction?.mission
      })
      this.context.effects.rewardApplied = true
    }
    this.context.effects.meetingFinalized = true
    S().setMeeting({
      status: 'done',
      resultGameId: game.id,
      resultVersion: release.version,
      reward,
      hitl: { status: 'idle', pending: [] }
    })
    S().toast(`🎉 ${game.title} ${release.version} 릴리즈 완료!`, 'success')
    this.context.cursor.node = 'done'
    this.context.cursor.releaseStep = 'done'
  }

  async _finishRun() {
    const game = this.context.effects.gameSaved
    const release = this.context.release
    S().setMeeting({ status: 'done', hitl: { status: 'idle', pending: [] } })
    await this._checkpoint('done')
    this.checkpointer.clearLocal()
    this._releaseMeetingSeats()
    return game ? { gameId: game.id, version: release?.version } : null
  }

  _parseMeta(prd, agenda, code, existing) {
    const pick = expression => (String(prd || '').match(expression) || [])[1]?.trim()
    let title = pick(/제목\s*[:：]\s*(.+)/) || existing?.title
    if (!title) title = (String(code || '').match(/title\s*:\s*['"`]([^'"`]+)['"`]/) || [])[1]
    title = (title || String(agenda || '').slice(0, 16)).replace(/["'`*]/g, '').slice(0, 24)
    const emoji = (pick(/이모지\s*[:：]\s*(.+)/) || existing?.emoji || '🎮').split(/\s/)[0].slice(0, 4)
    const genre = pick(/장르\s*[:：]\s*(.+)/) || existing?.genre || '아케이드'
    const desc = pick(/한줄설명\s*[:：]\s*(.+)/) || existing?.desc || String(agenda || '').slice(0, 60)
    const controls = [...new Set((String(code || '').match(/'(Arrow(?:Left|Right|Up|Down)|Space)'/g) || []).map(value => value.replace(/'/g, '')))]
    const colors = ['#3ec6a8', '#7dc7ff', '#b78cff', '#f2a25c', '#ff8a9e', '#7de0a0', '#ffd24a']
    return {
      id: existing?.id || `game-${S().meeting.id}`,
      title, emoji, genre, desc,
      controls: controls.length ? controls : ['ArrowLeft', 'ArrowRight'],
      color: existing?.color || colors[Math.abs(this._numericHash(S().meeting.id)) % colors.length]
    }
  }

  _numericHash(value) {
    let result = 0
    for (const char of String(value || '')) result = ((result * 31) + char.charCodeAt(0)) | 0
    return result
  }

  _codeHash(code) {
    return (this._numericHash(code) >>> 0).toString(16).padStart(8, '0')
  }

  _seatMeeting() {
    const world = this.world
    const layout = world?.maps?.office?.meeting
    if (!world || !layout) return
    world.meetingMode = true
    TEAM.forEach((member, index) => {
      const seat = layout.seats[index]
      world.goTo?.(member.id, seat, () => world.sit?.(member.id, seat, layout.faces[index]))
    })
    world.freezePlayer = true
    world.playerAutoWalk?.(layout.head, () => world.face?.('player', layout.headFace))
  }

  _releaseMeetingSeats() {
    const world = this.world
    if (!world) return
    world.meetingMode = false
    world.freezePlayer = false
    TEAM.forEach(member => {
      const home = world.agent?.(member.id)?.home
      if (home) world.goTo?.(member.id, home.desk, () => world.sit?.(member.id, home.desk, home.face))
    })
  }
}
