import test from 'node:test'
import assert from 'node:assert/strict'
import { TEAM } from '../data/personas.js'
import { useStore } from '../state/store.js'
import {
  MEETING_AGENT_IDS,
  MeetingCheckpointer,
  createMeetingCheckpoint,
  createMeetingRunContext,
  recordAgentExchange
} from './checkpointer.js'
import { MeetingEngine } from './resumableEngine.js'

const copy = value => structuredClone(value)

async function within(promise, label, timeoutMs = 1500) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function eventually(predicate, label, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function rejectWhenAborted(signal) {
  return new Promise((_, reject) => {
    const abort = () => {
      const error = new Error('request aborted by HITL')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

class FakeCheckpointer {
  constructor(checkpoint = null) {
    this.revision = checkpoint?.revision || 0
    this.last = checkpoint ? copy(checkpoint) : null
    this.saves = []
    this.clearCount = 0
    this._writes = Promise.resolve()
  }

  save({ meetingId, status, context, meeting }) {
    const operation = this._writes.then(() => {
      const checkpoint = createMeetingCheckpoint({
        meetingId,
        revision: this.revision + 1,
        status,
        context,
        meeting,
        savedAt: `2026-08-26T03:00:${String((this.revision + 1) % 60).padStart(2, '0')}.000Z`
      })
      this.revision = checkpoint.revision
      this.last = copy(checkpoint)
      this.saves.push(copy(checkpoint))
      return copy(checkpoint)
    })
    this._writes = operation.catch(() => {})
    return operation
  }

  async loadLatest() {
    return this.last ? copy(this.last) : null
  }

  async load(meetingId) {
    return this.last?.meetingId === meetingId ? copy(this.last) : null
  }

  clearLocal() {
    this.clearCount++
  }
}

class BlockingCheckpointer extends FakeCheckpointer {
  blockNextSave() {
    const started = deferred()
    const released = deferred()
    this._nextBlock = { started, released }
    return {
      started: started.promise,
      release: () => released.resolve()
    }
  }

  save({ meetingId, status, context, meeting }) {
    if (!this._nextBlock) return super.save({ meetingId, status, context, meeting })
    const block = this._nextBlock
    this._nextBlock = null
    const operation = this._writes.then(async () => {
      block.started.resolve()
      await block.released.promise
      const checkpoint = createMeetingCheckpoint({
        meetingId,
        revision: this.revision + 1,
        status,
        context,
        meeting,
        savedAt: `2026-08-26T03:10:${String((this.revision + 1) % 60).padStart(2, '0')}.000Z`
      })
      this.revision = checkpoint.revision
      this.last = copy(checkpoint)
      this.saves.push(copy(checkpoint))
      return copy(checkpoint)
    })
    this._writes = operation.catch(() => {})
    return operation
  }
}

class FailingOnceCheckpointer extends FakeCheckpointer {
  failNextSave(error = new Error('transient checkpoint outage')) {
    this._nextFailure = error
  }

  save(args) {
    if (!this._nextFailure) return super.save(args)
    const error = this._nextFailure
    this._nextFailure = null
    const operation = this._writes.then(() => { throw error })
    this._writes = operation.catch(() => {})
    return operation
  }
}

function freshStudio() {
  return {
    level: 1,
    totalXp: 0,
    coins: 0,
    releaseStreak: 0,
    releases: 0,
    activeMission: null,
    lastReward: null,
    releaseRewards: {}
  }
}

function resetStore() {
  useStore.setState({
    config: { llm: 'mock', models: {}, webSearch: false },
    games: [],
    map: 'office',
    panel: null,
    panelData: null,
    meeting: null,
    arcade: null,
    toasts: [],
    studio: freshStudio(),
    settings: { autoApprove: false, simConcurrency: 1 },
    toast: () => {}
  })
}

function fakeWorld() {
  const calls = { bubbles: [], emotes: [], shelfGames: [] }
  return {
    calls,
    maps: {},
    bubble(agentId, text) { calls.bubbles.push({ agentId, text }) },
    emote(agentId, active) { calls.emotes.push({ agentId, active }) },
    agent() { return null },
    setShelfGames(games) { calls.shelfGames.push(copy(games)) }
  }
}

function baseApi(overrides = {}) {
  return {
    async createMeeting() { return { meeting: { id: 'meeting-resumable-test', revision: 0 } } },
    async bundle() { return { code: 'window.game = {}' } },
    async ragQuery() { return { results: [{ kind: 'prd', text: '이전 회의의 결정적 근거' }] } },
    async search() { return { answer: '', results: [] } },
    async referenceResearch() { throw new Error('reference research is not configured in this test') },
    async generate(body) { return { text: `${body.hint || 'agent'} response`, sources: [] } },
    async stream(body, onDelta) {
      const text = `${body.hint || 'stream'} response`
      onDelta?.(text, text)
      return { text, sources: [] }
    },
    async createGame(body) {
      return { game: { id: body.id, title: body.title, emoji: body.emoji || '🎮', version: 'v1.0.0' } }
    },
    async addVersion(id, body) {
      return { game: { id, title: '업그레이드 게임', emoji: '🎮', version: body.version } }
    },
    async game(id) { return { game: { id, title: '복원 게임', emoji: '🎮', version: 'v1.0.0' } } },
    async ragUpsert() { return { ok: true } },
    async games() { return { games: [] } },
    async files() { return { files: {} } },
    ...overrides
  }
}

function researchMeeting(context, { id = 'meeting-resumable-test', status = 'paused' } = {}) {
  return {
    id,
    agenda: context.input.agenda,
    phase: context.cursor.node === 'concept' ? 'concept' : 'research',
    phaseLabel: context.cursor.node === 'concept' ? '컨셉 토론' : '리서치',
    transcript: [],
    artifacts: copy(context.artifacts),
    status,
    gameId: context.input.upgradeGame?.id || null,
    upgrade: !!context.input.upgradeGame,
    approval: null,
    qaPreview: false,
    research: {
      status: 'pending',
      keywords: [],
      reference: { enabled: false, status: 'disabled' },
      members: Object.fromEntries(MEETING_AGENT_IDS.map(agentId => [agentId, {
        rag: 'pending', ragHits: 0, web: 'skipped', webHits: 0, note: 'pending'
      }]))
    },
    directionGate: null,
    direction: copy(context.direction),
    reward: null,
    interventions: copy(context.interventions),
    checkpointMeta: null,
    checkpointError: null,
    hitl: { status: status === 'paused' ? 'paused' : 'idle', pending: [] }
  }
}

test('research pause aborts the in-flight agent request and commits a paused checkpoint', async () => {
  resetStore()
  const requestStarted = deferred()
  let researchSignal = null
  const api = baseApi({
    generate(body, { signal } = {}) {
      researchSignal = signal
      requestStarted.resolve(copy(body))
      return rejectWhenAborted(signal)
    }
  })
  const checkpointer = new FakeCheckpointer()
  const engine = new MeetingEngine(fakeWorld(), {
    api,
    checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })

  const runPromise = engine.run('리서치 중에도 팀장이 끼어드는 게임')
  const request = await within(requestStarted.promise, 'research generation')
  assert.equal(request.hint, 'research')

  await within(engine.pause('핵심 조작을 한 버튼으로 줄여 주세요.'), 'pausing checkpoint')
  const result = await within(runPromise, 'paused research run')

  assert.equal(result, null)
  assert.equal(researchSignal.aborted, true)
  assert.equal(useStore.getState().meeting.status, 'paused')
  assert.equal(engine.context.cursor.node, 'research')
  assert.equal(engine.context.cursor.researchAgentIndex, 0)
  assert.equal(engine.context.agents.pm.turns.length, 0)
  assert.equal(checkpointer.last.status, 'paused')
  assert.equal(checkpointer.last.context.cursor.node, 'research')
  assert.equal(checkpointer.last.context.interventions[0].text, '핵심 조작을 한 버튼으로 줄여 주세요.')
  assert.ok(checkpointer.saves.some(checkpoint => checkpoint.status === 'pausing'))
  assert.ok(checkpointer.saves.some(checkpoint => checkpoint.status === 'paused'))
})

test('pause waits for an in-flight checkpoint and never overwrites its newer cursor', async () => {
  resetStore()
  const oldContext = createMeetingRunContext({ agenda: 'checkpoint ACK race' })
  oldContext.cursor.node = 'research'
  oldContext.cursor.researchAgentIndex = 0
  const oldMeeting = researchMeeting(oldContext, { id: 'meeting-write-race', status: 'running' })
  const committed = createMeetingCheckpoint({
    meetingId: oldMeeting.id,
    revision: 2,
    status: 'running',
    context: oldContext,
    meeting: oldMeeting,
    savedAt: '2026-08-26T03:10:02.000Z'
  })
  const checkpointer = new BlockingCheckpointer(committed)
  const newerContext = copy(oldContext)
  newerContext.cursor.researchAgentIndex = 1
  newerContext.agents.pm.note = '방금 완료된 PM 조사 원문'
  const newerMeeting = copy(oldMeeting)
  newerMeeting.transcript.push({ ts: 30, agentId: 'pm', kind: 'note', phase: 'research', text: 'PM 완료 발언' })
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  engine.context = newerContext
  useStore.getState().replaceMeeting(newerMeeting)
  const block = checkpointer.blockNextSave()

  const nodeCheckpoint = engine._checkpoint('running')
  await within(block.started, 'in-flight node checkpoint')
  const pauseCheckpoint = engine.pause('PM 조사 결과를 유지한 채 멈춰 주세요.')
  block.release()
  await within(nodeCheckpoint, 'node checkpoint ACK')
  await within(pauseCheckpoint, 'queued pause checkpoint ACK')
  await within(engine._enterPaused(), 'enter paused after write race')

  assert.equal(engine.context.cursor.researchAgentIndex, 1)
  assert.equal(engine.context.agents.pm.note, '방금 완료된 PM 조사 원문')
  assert.match(useStore.getState().meeting.transcript.map(entry => entry.text).join('\n'), /PM 완료 발언/)
  assert.equal(checkpointer.last.status, 'paused')
  assert.equal(checkpointer.last.context.cursor.researchAgentIndex, 1)
})

test('a failed pausing write still applies guidance and retries a complete paused checkpoint', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: 'control save retry' })
  context.cursor.node = 'research'
  const meeting = researchMeeting(context, { id: 'meeting-control-retry', status: 'running' })
  const committed = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 2,
    status: 'running',
    context,
    meeting,
    savedAt: '2026-08-26T03:20:02.000Z'
  })
  const checkpointer = new FailingOnceCheckpointer(committed)
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  engine.context = copy(context)
  useStore.getState().replaceMeeting(copy(meeting))
  checkpointer.failNextSave()

  await assert.rejects(engine.pause('실패해도 이 지시는 잃지 마세요.'), /transient checkpoint outage/)
  await within(engine._enterPaused(), 'paused retry after control failure')

  assert.equal(useStore.getState().meeting.status, 'paused')
  assert.equal(useStore.getState().meeting.checkpointError, null)
  assert.equal(engine.context.interventions.length, 1)
  assert.equal(engine.context.interventions[0].text, '실패해도 이 지시는 잃지 마세요.')
  assert.equal(checkpointer.last.status, 'paused')
  assert.equal(checkpointer.last.context.interventions.length, 1)
})

test('pause during a gate checkpoint does not enter the 12 second direction timer', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: 'gate checkpoint race' })
  context.cursor.node = 'direction'
  context.research.result = { status: 'done', keywords: ['한손', '피드백'] }
  const meeting = researchMeeting(context, { id: 'meeting-gate-race', status: 'running' })
  const committed = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 3,
    status: 'running',
    context,
    meeting,
    savedAt: '2026-08-26T03:30:03.000Z'
  })
  const checkpointer = new BlockingCheckpointer(committed)
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  engine.context = copy(context)
  useStore.getState().replaceMeeting(copy(meeting))
  const block = checkpointer.blockNextSave()

  const gateRun = engine._runDirectionGate()
  await within(block.started, 'direction gate checkpoint')
  const pauseSave = engine.pause()
  block.release()
  await assert.rejects(gateRun, /meeting-paused/)
  await within(pauseSave, 'gate pause checkpoint')
  await within(engine._enterPaused(), 'paused direction gate')

  assert.equal(engine._direction, null)
  assert.equal(useStore.getState().meeting.status, 'paused')
  assert.equal(engine.context.cursor.node, 'direction')
  assert.ok(Number.isFinite(engine.context.gates.direction.remainingMs))
})

test('resume injects one human instruction into all five agent contexts and the next prompt', async () => {
  resetStore()
  const initialStarted = deferred()
  const nextAgentStarted = deferred()
  let generation = 0
  let resumedPmRequest = null
  const signals = []
  const api = baseApi({
    generate(body, { signal } = {}) {
      generation++
      signals.push(signal)
      if (generation === 1) {
        initialStarted.resolve(copy(body))
        return rejectWhenAborted(signal)
      }
      if (generation === 2) {
        resumedPmRequest = copy(body)
        return Promise.resolve({ text: 'PM이 팀장 지시를 반영한 조사 결과', sources: [] })
      }
      if (generation === 3) {
        nextAgentStarted.resolve(copy(body))
        return rejectWhenAborted(signal)
      }
      return Promise.resolve({ text: `agent response ${generation}`, sources: [] })
    }
  })
  const checkpointer = new FakeCheckpointer()
  const engine = new MeetingEngine(fakeWorld(), {
    api,
    checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  const instruction = '점수 경쟁보다 초보자의 입력 피드백을 우선해 주세요.'

  const firstRun = engine.run('HITL 재개 프롬프트 테스트')
  await within(initialStarted.promise, 'initial PM research')
  await within(engine.pause(instruction), 'first pause save')
  await within(firstRun, 'first paused run')

  assert.equal(engine.context.interventions.length, 1)
  for (const agentId of MEETING_AGENT_IDS) {
    const injected = engine.context.agents[agentId].messages.filter(message => message.kind === 'human-intervention')
    assert.equal(injected.length, 1, agentId)
    assert.equal(injected[0].text, instruction, agentId)
  }

  await within(engine.resume(), 'resume control acknowledgement')
  const resumedRun = engine.waitForIdle()
  const nextRequest = await within(nextAgentStarted.promise, 'next research agent after resume')
  assert.equal(nextRequest.hint, 'research')
  await within(engine.pause(), 'second pause save')
  await within(resumedRun, 'second paused run')

  const promptText = resumedPmRequest.messages.map(message => message.text).join('\n')
  assert.match(promptText, /팀장 실시간 개입/)
  const escapedInstruction = instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(promptText, new RegExp(escapedInstruction))
  assert.equal((promptText.match(new RegExp(escapedInstruction, 'g')) || []).length, 1)
  assert.equal(engine.context.agents.pm.turns.filter(turn => turn.id === 'research:pm').length, 1)
  assert.equal(engine.context.cursor.researchAgentIndex, 1)
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[2].aborted, true)
  assert.equal(checkpointer.last.status, 'paused')
})

test('a new engine hydrates the exact cursor, artifacts and raw transcript then skips a completed concept turn', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: '복원 후 완료 turn 건너뛰기' })
  context.cursor = {
    ...context.cursor,
    node: 'concept',
    debateRound: 1,
    debateAgentIndex: 1
  }
  context.direction = {
    id: 'stable', title: '안정 완성', icon: '🛡️', summary: '핵심만 구현',
    mission: { id: 'meeting-restore:stable', metric: 'errors', target: 0, label: '오류 0건' }
  }
  context.artifacts = {
    prd: '# 복원 PRD\n원문 보존',
    design: '# 복원 디자인\n원문 보존',
    arch: '# 복원 설계\n원문 보존',
    code: 'window.game = { restored: true }'
  }
  context.agents.writer.note = '작가의 비공유 조사 메모'
  recordAgentExchange(context, 'writer', {
    phase: 'concept',
    kind: 'talk',
    input: '1라운드 작가 입력 원문',
    output: '1라운드 작가 완료 응답',
    turnId: 'debate:1:writer'
  })
  const meeting = researchMeeting(context, { id: 'meeting-restore' })
  meeting.phase = 'concept'
  meeting.phaseLabel = '컨셉 토론'
  meeting.transcript = [
    { ts: 10, agentId: 'system', kind: 'system', phase: 'concept', text: '— 컨셉 토론 원문 —', phaseMarker: true },
    { ts: 11, agentId: 'writer', kind: 'talk', phase: 'concept', text: '1라운드 작가 완료 응답', turnId: 'debate:1:writer' }
  ]
  const rawTranscript = copy(meeting.transcript)
  const checkpoint = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 8,
    status: 'paused',
    context,
    meeting,
    savedAt: '2026-08-26T04:00:00.000Z'
  })
  const checkpointer = new FakeCheckpointer(checkpoint)
  const streamStarted = deferred()
  let conceptSignal = null
  const streamCalls = []
  const api = baseApi({
    stream(body, _onDelta, { signal } = {}) {
      conceptSignal = signal
      streamCalls.push(copy(body))
      streamStarted.resolve(copy(body))
      return rejectWhenAborted(signal)
    }
  })
  const engine = new MeetingEngine(fakeWorld(), {
    api,
    checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })

  const restored = await within(engine.restoreLatest(), 'restoreLatest')

  assert.equal(restored.status, 'paused')
  assert.equal(restored.recovered, true)
  assert.deepEqual(engine.context.cursor, context.cursor)
  assert.deepEqual(engine.context.artifacts, context.artifacts)
  assert.deepEqual(useStore.getState().meeting.transcript.slice(0, rawTranscript.length), rawTranscript)
  assert.match(useStore.getState().meeting.transcript.at(-1).text, /전체 멀티에이전트 컨텍스트를 복원/)
  assert.equal(engine.context.agents.writer.turns.filter(turn => turn.id === 'debate:1:writer').length, 1)

  await within(engine.resume(), 'restore resume acknowledgement')
  const resumedRun = engine.waitForIdle()
  const resumedRequest = await within(streamStarted.promise, 'restored concept turn')
  assert.equal(resumedRequest.hint, 'debate')
  assert.equal(resumedRequest.personaMeta.idx, TEAM.findIndex(member => member.id === 'designer'))
  await within(engine.pause(), 'concept pause checkpoint')
  await within(resumedRun, 'paused restored concept run')

  assert.equal(conceptSignal.aborted, true)
  assert.equal(streamCalls.length, 1)
  assert.equal(engine.context.cursor.node, 'concept')
  assert.equal(engine.context.cursor.debateRound, 1)
  assert.equal(engine.context.cursor.debateAgentIndex, 1)
  assert.equal(engine.context.agents.writer.turns.filter(turn => turn.id === 'debate:1:writer').length, 1)
  assert.equal(engine.context.agents.designer.turns.filter(turn => turn.id === 'debate:1:designer').length, 0)
  assert.equal(checkpointer.last.status, 'paused')
})

test('a pausing crash restores pending human guidance into every agent before resume', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: 'pausing 중 새로고침 복구' })
  context.cursor.node = 'research'
  context.pendingInterventions.push({
    id: 'human:crash-window',
    phase: 'research',
    text: '모바일 한 손 조작을 가장 먼저 검토해 주세요.',
    createdAt: '2026-08-26T04:20:00.000Z'
  })
  const meeting = researchMeeting(context, { id: 'meeting-pausing-crash', status: 'pausing' })
  meeting.hitl = { status: 'pausing', pending: copy(context.pendingInterventions) }
  const checkpoint = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 6,
    status: 'pausing',
    context,
    meeting,
    savedAt: '2026-08-26T04:20:01.000Z'
  })
  const checkpointer = new FakeCheckpointer(checkpoint)
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })

  await within(engine.restoreLatest(), 'pausing checkpoint restore')

  assert.equal(engine.context.pendingInterventions.length, 0)
  assert.equal(engine.context.interventions.length, 1)
  assert.equal(engine.context.interventions[0].id, 'human:crash-window')
  for (const agentId of MEETING_AGENT_IDS) {
    assert.equal(
      engine.context.agents[agentId].messages.filter(message => message.id === 'human:crash-window').length,
      1,
      agentId
    )
  }
  assert.equal(
    useStore.getState().meeting.transcript.filter(entry => entry.interventionId === 'human:crash-window').length,
    1
  )
  assert.equal(checkpointer.last.status, 'paused')
})

test('a stale tab adopts the authoritative remote checkpoint instead of overwriting it', async () => {
  resetStore()
  const localContext = createMeetingRunContext({ agenda: '멀티 탭 CAS 복구' })
  localContext.cursor.node = 'concept'
  localContext.cursor.debateAgentIndex = 0
  const localMeeting = researchMeeting(localContext, { id: 'meeting-cas-recovery' })
  const localCheckpoint = createMeetingCheckpoint({
    meetingId: localMeeting.id,
    revision: 3,
    status: 'paused',
    context: localContext,
    meeting: localMeeting,
    savedAt: '2026-08-26T04:25:00.000Z'
  })
  const remoteContext = copy(localContext)
  remoteContext.cursor.debateAgentIndex = 2
  remoteContext.agents.writer.note = '다른 탭이 저장한 최신 비공유 메모'
  const remoteMeeting = copy(localMeeting)
  remoteMeeting.transcript.push({ ts: 20, agentId: 'writer', kind: 'talk', phase: 'concept', text: '다른 탭의 완료 발언' })
  const remoteCheckpoint = createMeetingCheckpoint({
    meetingId: remoteMeeting.id,
    revision: 4,
    status: 'paused',
    context: remoteContext,
    meeting: remoteMeeting,
    savedAt: '2026-08-26T04:25:02.000Z'
  })
  const conflict = Object.assign(new Error('stale meeting revision'), {
    status: 409,
    code: 'MEETING_REVISION_CONFLICT'
  })
  const checkpointer = new MeetingCheckpointer({
    saveRemote: async () => { throw conflict },
    loadRemote: async () => ({ meeting: { revision: 4, checkpoint: remoteCheckpoint } })
  })
  checkpointer.revision = 3
  checkpointer.last = copy(localCheckpoint)
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  engine.context = copy(localContext)
  useStore.getState().replaceMeeting(copy(localMeeting))

  await assert.rejects(engine.resume(), /체크포인트 저장 실패/)

  assert.equal(checkpointer.revision, 4)
  assert.equal(engine.context.cursor.debateAgentIndex, 2)
  assert.equal(engine.context.agents.writer.note, '다른 탭이 저장한 최신 비공유 메모')
  assert.equal(useStore.getState().meeting.status, 'paused')
  assert.match(useStore.getState().meeting.transcript.at(-1).text, /다른 탭의 완료 발언/)
})

test('direction and approval countdown time is frozen while paused and rebuilt on resume', async () => {
  resetStore()
  const savedAt = '2026-08-26T04:30:00.000Z'
  const savedTime = Date.parse(savedAt)
  const context = createMeetingRunContext({ agenda: '게이트 타이머도 멈추는 회의' })
  const option = {
    id: 'stable', title: '안정 완성', icon: '🛡️', tag: 'STABLE', summary: '핵심 완성', risk: '낮음',
    mission: { metric: 'errors', target: 0, label: '오류 0건' }, recommended: true
  }
  context.cursor.node = 'direction'
  context.research.result = { status: 'done', keywords: [] }
  context.gates.direction = {
    options: [option], recommendedId: option.id, selectedId: null, auto: false,
    announced: true, deadline: savedTime + 8_000
  }
  context.gates.approval = {
    auto: false, value: null, deadline: savedTime + 42_000
  }
  const meeting = researchMeeting(context, { id: 'meeting-gate-timers' })
  meeting.directionGate = { options: [option], recommendedId: option.id, until: savedTime + 8_000 }
  meeting.approval = { auto: false, until: savedTime + 42_000 }
  const checkpoint = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 5,
    status: 'paused',
    context,
    meeting,
    savedAt
  })
  const checkpointer = new FakeCheckpointer(checkpoint)
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(), checkpointer,
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })

  await within(engine.restoreLatest(), 'gate restore')
  assert.equal(engine.context.gates.direction.deadline, undefined)
  assert.equal(engine.context.gates.direction.remainingMs, 8_000)
  assert.equal(engine.context.gates.approval.remainingMs, 42_000)
  assert.equal(useStore.getState().meeting.directionGate.until, null)

  await within(engine.resume(), 'gate resume acknowledgement')
  const resumedRun = engine.waitForIdle()
  await eventually(() => engine._direction, 'restored direction gate')
  const thawedRemaining = engine.context.gates.direction.deadline - Date.now()
  assert.ok(thawedRemaining > 7_800 && thawedRemaining <= 8_000, thawedRemaining)

  await within(engine.pause(), 'gate pause save')
  await within(resumedRun, 'gate paused run')
  assert.equal(engine.context.gates.direction.deadline, undefined)
  assert.ok(engine.context.gates.direction.remainingMs > 7_700)
  assert.equal(useStore.getState().meeting.status, 'paused')
})

test('QA smoke test receives HITL AbortSignal and rolls back its partial diagnostics', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: 'QA 중 즉시 개입' })
  context.cursor.node = 'qa_test'
  context.direction = {
    id: 'stable', title: '안정 완성',
    mission: { id: 'qa-abort:stable', metric: 'errors', target: 0, label: '오류 0건' }
  }
  context.artifacts.code = 'window.game = { start() {}, dispose() {} }'
  const meeting = researchMeeting(context, { id: 'meeting-qa-abort' })
  meeting.phase = 'qa'
  meeting.phaseLabel = 'QA'
  meeting.artifacts = copy(context.artifacts)
  const checkpoint = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 4,
    status: 'paused',
    context,
    meeting,
    savedAt: '2026-08-26T04:40:00.000Z'
  })
  const checkpointer = new FakeCheckpointer(checkpoint)
  const smokeStarted = deferred()
  let smokeSignal = null
  const engine = new MeetingEngine(fakeWorld(), {
    api: baseApi(),
    checkpointer,
    smokeTest: (_code, { signal }) => {
      smokeSignal = signal
      smokeStarted.resolve()
      return rejectWhenAborted(signal)
    },
    sleep: async () => {}
  })

  await within(engine.restoreLatest(), 'QA restore')
  await within(engine.resume(), 'QA resume acknowledgement')
  const resumedRun = engine.waitForIdle()
  await within(smokeStarted.promise, 'QA smoke start')
  await within(engine.pause('QA 진단 전에 입력 반응을 다시 확인해 주세요.'), 'QA pause save')
  await within(resumedRun, 'QA paused run')

  assert.equal(smokeSignal.aborted, true)
  assert.equal(engine.context.cursor.node, 'qa_test')
  assert.equal(engine.context.qa.history.length, 0)
  assert.equal(useStore.getState().meeting.qaPreview, false)
  assert.equal(useStore.getState().meeting.status, 'paused')
})

test('release save and reward effects remain exactly-once when their nodes are retried', async () => {
  resetStore()
  const context = createMeetingRunContext({ agenda: '릴리즈 멱등성 테스트' })
  context.cursor.node = 'release_save'
  context.cursor.releaseStep = 'save'
  context.direction = {
    id: 'stable',
    mission: { id: 'meeting-release:stable', metric: 'errors', target: 0, label: '오류 0건' }
  }
  context.qa.pass = true
  context.artifacts.prd = '# PRD'
  context.release = {
    meta: {
      id: 'game-meeting-release', title: '멱등 별배달', desc: '릴리즈 테스트',
      genre: '아케이드', controls: ['ArrowLeft'], emoji: '⭐', color: '#ffd24a'
    },
    version: 'v1.0.0',
    files: { 'game.js': 'window.game = {}' },
    changelogText: '- 최초 출시',
    idempotencyKey: 'meeting-release:release:v1.0.0'
  }
  const meeting = researchMeeting(context, { id: 'meeting-release' })
  meeting.phase = 'release'
  meeting.reward = null
  useStore.getState().replaceMeeting(meeting)

  const createCalls = []
  const releasedGame = { id: 'game-meeting-release', title: '멱등 별배달', emoji: '⭐', version: 'v1.0.0' }
  const api = baseApi({
    async createGame(body) {
      createCalls.push(copy(body))
      return { game: copy(releasedGame) }
    },
    async games() { return { games: [copy(releasedGame)] } }
  })
  const engine = new MeetingEngine(fakeWorld(), {
    api,
    checkpointer: new FakeCheckpointer(),
    smokeTest: async () => ({ pass: true, diagnostics: {} }),
    sleep: async () => {}
  })
  engine.context = context

  await engine._saveRelease()
  await engine._saveRelease()

  assert.equal(createCalls.length, 1)
  assert.equal(createCalls[0].idempotencyKey, context.release.idempotencyKey)
  assert.equal(useStore.getState().meeting.transcript.filter(entry => entry.releaseSaved).length, 1)

  await engine._finalizeRelease()
  const studioAfterFirstFinalize = copy(useStore.getState().studio)
  await engine._finalizeRelease()

  assert.deepEqual(useStore.getState().studio, studioAfterFirstFinalize)
  assert.equal(useStore.getState().studio.releases, 1)
  assert.equal(Object.keys(useStore.getState().studio.releaseRewards).length, 1)
  assert.ok(useStore.getState().studio.releaseRewards['meeting-release'])
  assert.equal(context.effects.rewardApplied, true)
  assert.equal(context.effects.meetingFinalized, true)
})
