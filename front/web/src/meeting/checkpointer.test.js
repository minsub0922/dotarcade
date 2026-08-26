import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEETING_AGENT_IDS,
  MeetingCheckpointer,
  appendHumanIntervention,
  checkpointHash,
  createMeetingCheckpoint,
  createMeetingRunContext,
  humanInterventionContext,
  hydrateMeetingCheckpoint,
  recordAgentExchange,
  validateMeetingCheckpoint
} from './checkpointer.js'

const copy = value => structuredClone(value)

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

function fullMeetingState(label = 'roundtrip') {
  const context = createMeetingRunContext({
    agenda: `별빛 배송 게임 ${label}`,
    upgradeGame: {
      id: 'game-starlight',
      version: 'v1.2.0',
      feedback: { 'v1.2.0': { avg: 7.8, summary: '후반부 템포를 다듬어 주세요.' } }
    },
    referenceSearch: true,
    referenceTarget: '읽기 쉬운 배달 HUD'
  })

  context.cursor = {
    node: 'qa',
    researchAgentIndex: 5,
    debateRound: 2,
    debateAgentIndex: 5,
    documentIndex: 3,
    reviewAgentIndex: 2,
    qaAttempt: 2,
    releaseStep: 'pending'
  }

  for (const [index, agentId] of MEETING_AGENT_IDS.entries()) {
    const agent = context.agents[agentId]
    agent.research = {
      ragNotes: `${agentId} RAG 원문\n- 근거 ${index + 1}`,
      webNotes: `${agentId} web 원문 <tag-${index}>`,
      sources: [{ title: `${agentId} source`, uri: `https://example.test/${agentId}?q=${index}` }]
    }
    agent.note = `${agentId}의 비공유 조사 메모 ${index}`
    recordAgentExchange(context, agentId, {
      phase: 'concept',
      kind: 'talk',
      input: `[공유 문맥]\n${agentId}에게 묻는 원문`,
      output: `${agentId} 응답 원문\n\`코드·기호 ${index}\``,
      sources: agent.research.sources,
      turnId: `concept:2:${agentId}`
    })
  }

  context.sharedMessages.push({
    id: 'shared:raw:1', role: 'assistant', phase: 'review', kind: 'talk',
    text: '공유 메시지 원문\n두 번째 줄'
  })
  context.research = {
    corpus: ['별빛 배송 게임', 'RAG 원문', '웹 검색 원문'],
    result: { keywords: ['배송', '별빛'], members: { pm: { status: 'done' } } },
    referenceResult: {
      selected: { id: 'ref-1', title: 'Reference One' },
      evidence: [{ id: 'e-1', excerpt: '검증 근거 원문' }]
    },
    referenceContext: '[레퍼런스 브리프]\n정보 구조만 차용',
    referenceDesignContract: {
      contractId: 'contract-1',
      qa: { requiredScreens: ['title', 'gameplay', 'result'] }
    }
  }
  context.upgrade = {
    info: 'v1.2.0 피드백 원문',
    currentCode: 'window.game = { /* 기존 코드 원문 */ }'
  }
  context.direction = {
    id: 'feel', title: '손맛 집중',
    mission: { id: 'm-checkpoint:feel', metric: 'controls', target: 7 }
  }
  context.artifacts = {
    prd: '# PRD\n\n요구사항 원문',
    design: '# Design\n\n색상 #aabbcc',
    arch: '# Architecture\n\nstate -> render',
    code: 'window.game = { start(canvas, api) { api.emit("checkpoint", { value: 1 }) } }'
  }
  context.qa = {
    attempt: 2,
    diagnostics: { score: 18, errors: [], visual: { missing: [] } },
    pass: true,
    history: [
      { attempt: 1, pass: false, diagnostics: { fatal: '첫 실행 실패' } },
      { attempt: 2, pass: true, diagnostics: { score: 18 } }
    ]
  }
  appendHumanIntervention(context, '점수보다 조작 피드백을 우선해 주세요.', {
    id: 'human:checkpoint:1',
    phase: 'design',
    createdAt: '2026-08-26T01:02:03.000Z'
  })
  context.pendingInterventions.push({ id: 'human:pending:1', text: 'QA 결과도 설명해 주세요.' })
  context.gates = {
    direction: null,
    approval: { requestedAt: '2026-08-26T01:03:00.000Z', remainingMs: 42_000 }
  }
  context.effects = {
    gameSaved: { id: 'game-starlight', version: 'v1.3.0' },
    ragSaved: true,
    meetingFinalized: false,
    rewardApplied: false
  }

  const meeting = {
    id: 'meeting-checkpoint-1',
    agenda: context.input.agenda,
    status: 'paused',
    phase: 'qa',
    artifacts: copy(context.artifacts),
    transcript: [
      { ts: 1, agentId: 'system', kind: 'system', phase: 'kickoff', text: '— 킥오프 —' },
      { ts: 2, agentId: 'player', kind: 'player', phase: 'kickoff', text: '원문 안건\n그대로 보존' },
      { ts: 3, agentId: 'dev1', kind: 'qa', phase: 'qa', text: '🧪 QA 원문: <>&\"' },
      { ts: 4, agentId: 'player', kind: 'human-intervention', phase: 'design', text: '점수보다 조작 피드백을 우선해 주세요.' }
    ],
    research: copy(context.research),
    direction: copy(context.direction),
    qa: copy(context.qa)
  }

  return { context, meeting }
}

function checkpointFixture({ revision = 3, label = 'fixture' } = {}) {
  const { context, meeting } = fullMeetingState(label)
  return createMeetingCheckpoint({
    meetingId: meeting.id,
    revision,
    status: meeting.status,
    context,
    meeting,
    savedAt: '2026-08-26T01:04:05.000Z'
  })
}

test('full five-agent meeting context survives a raw JSON checkpoint round trip with a stable hash', () => {
  const { context, meeting } = fullMeetingState()
  const checkpoint = createMeetingCheckpoint({
    meetingId: meeting.id,
    revision: 7,
    status: 'paused',
    context,
    meeting,
    savedAt: '2026-08-26T01:04:05.000Z'
  })

  const restored = hydrateMeetingCheckpoint(JSON.parse(JSON.stringify(checkpoint)))

  assert.deepEqual(restored, checkpoint)
  assert.equal(restored.contextHash, checkpointHash(restored))
  assert.deepEqual(restored.cursor, context.cursor)
  assert.deepEqual(restored.context.research, context.research)
  assert.deepEqual(restored.context.artifacts, context.artifacts)
  assert.deepEqual(restored.context.qa, context.qa)
  assert.deepEqual(restored.context.interventions, context.interventions)
  assert.deepEqual(restored.meeting.transcript, meeting.transcript)
  for (const agentId of MEETING_AGENT_IDS) {
    assert.deepEqual(restored.context.agents[agentId], context.agents[agentId], agentId)
  }

  restored.context.artifacts.code = 'mutated after hydrate'
  assert.notEqual(restored.context.artifacts.code, checkpoint.context.artifacts.code)
})

test('one human intervention is injected into shared context and every agent exactly once', () => {
  const context = createMeetingRunContext({ agenda: 'HITL 주입 테스트' })
  const options = {
    id: 'human:one',
    phase: 'concept',
    createdAt: '2026-08-26T02:00:00.000Z'
  }

  const first = appendHumanIntervention(context, '  핵심 루프를 더 단순하게 해 주세요.  ', options)
  const duplicate = appendHumanIntervention(context, '중복 요청은 무시되어야 합니다.', options)

  assert.deepEqual(duplicate, first)
  assert.equal(context.interventions.length, 1)
  assert.equal(context.sharedMessages.filter(message => message.id === options.id).length, 1)
  for (const agentId of MEETING_AGENT_IDS) {
    const injected = context.agents[agentId].messages.filter(message => message.id === options.id)
    assert.equal(injected.length, 1, agentId)
    assert.deepEqual(injected[0], {
      ...first,
      role: 'user',
      kind: 'human-intervention'
    })
  }
  assert.match(humanInterventionContext(context), /concept.*핵심 루프를 더 단순하게/s)
})

test('checkpoint validator rejects missing resumable context surfaces', () => {
  const cases = [
    ['one agent context', checkpoint => { delete checkpoint.context.agents.writer }, /writer/],
    ['cursor node', checkpoint => { delete checkpoint.cursor.node }, /cursor/],
    ['artifacts', checkpoint => { delete checkpoint.context.artifacts }, /artifacts/],
    ['QA history', checkpoint => { delete checkpoint.context.qa.history }, /QA/],
    ['interventions', checkpoint => { delete checkpoint.context.interventions }, /interventions/],
    ['raw transcript', checkpoint => { delete checkpoint.meeting.transcript }, /transcript/]
  ]

  for (const [name, removeRequiredValue, expected] of cases) {
    const checkpoint = checkpointFixture({ label: name })
    removeRequiredValue(checkpoint)
    checkpoint.contextHash = checkpointHash(checkpoint)
    assert.throws(() => validateMeetingCheckpoint(checkpoint), expected, name)
  }
})

test('checkpoint validator rejects functions, old schemas, and hash tampering', () => {
  const withFunction = checkpointFixture({ label: 'function' })
  withFunction.context.agents.pm.runtimeCallback = () => 'not serializable'
  assert.throws(() => validateMeetingCheckpoint(withFunction), /not JSON serializable/)

  const oldSchema = checkpointFixture({ label: 'old-schema' })
  oldSchema.schemaVersion = 0
  oldSchema.contextHash = checkpointHash(oldSchema)
  assert.throws(() => validateMeetingCheckpoint(oldSchema), /unsupported.*schema/)

  const tamperedContext = checkpointFixture({ label: 'tampered-context' })
  tamperedContext.context.artifacts.code += '\n// injected after save'
  assert.throws(() => validateMeetingCheckpoint(tamperedContext), /hash mismatch/)

  const tamperedTranscript = checkpointFixture({ label: 'tampered-transcript' })
  tamperedTranscript.meeting.transcript[1].text = '변조된 회의록'
  assert.throws(() => hydrateMeetingCheckpoint(tamperedTranscript), /hash mismatch/)
})

test('MeetingCheckpointer saves and loads complete checkpoints through local and remote stores', async () => {
  const storage = memoryStorage()
  const remote = new Map()
  const remoteWrites = []
  const { context, meeting } = fullMeetingState('remote-local')

  const writer = new MeetingCheckpointer({
    storage,
    storageKey: 'active-meeting',
    saveRemote: async (meetingId, { checkpoint, expectedRevision }) => {
      remoteWrites.push({ meetingId, expectedRevision })
      remote.set(meetingId, copy(checkpoint))
      return { meeting: { checkpoint: copy(checkpoint) } }
    }
  })
  const saved = await writer.save({ meetingId: meeting.id, status: 'paused', context, meeting })

  assert.equal(saved.revision, 1)
  assert.deepEqual(remoteWrites, [{ meetingId: meeting.id, expectedRevision: 0 }])
  assert.deepEqual(JSON.parse(storage.getItem('active-meeting')), saved)

  const localReader = new MeetingCheckpointer({ storage, storageKey: 'active-meeting' })
  assert.deepEqual(await localReader.loadLatest(), saved)
  assert.deepEqual(await localReader.load(meeting.id), saved)
  assert.equal(await localReader.load('another-meeting'), null)

  const remoteReader = new MeetingCheckpointer({
    storage: memoryStorage(),
    loadLatestRemote: async () => ({ checkpoint: copy(remote.get(meeting.id)) }),
    loadRemote: async meetingId => ({ meeting: { checkpoint: copy(remote.get(meetingId)) } })
  })
  assert.deepEqual(await remoteReader.loadLatest(), saved)
  assert.deepEqual(await remoteReader.load(meeting.id), saved)

  localReader.clearLocal()
  assert.equal(storage.getItem('active-meeting'), null)
})

test('loadLatest selects the highest valid revision across remote and local checkpoints', async () => {
  const storage = memoryStorage()
  const local = checkpointFixture({ revision: 4, label: 'local-latest' })
  const remote = checkpointFixture({ revision: 3, label: 'remote-older' })
  storage.setItem('latest-meeting', JSON.stringify(local))

  const checkpointer = new MeetingCheckpointer({
    storage,
    storageKey: 'latest-meeting',
    loadLatestRemote: async () => ({ checkpoint: remote })
  })

  assert.deepEqual(await checkpointer.loadLatest(), local)
  assert.equal(checkpointer.revision, 3)
})

test('a local crash copy one revision ahead is reconciled with the authoritative server CAS', async () => {
  const storage = memoryStorage()
  const local = checkpointFixture({ revision: 4, label: 'local-unacknowledged' })
  const remote = checkpointFixture({ revision: 3, label: 'remote-committed' })
  storage.setItem('crash-copy', JSON.stringify(local))
  const writes = []
  const checkpointer = new MeetingCheckpointer({
    storage,
    storageKey: 'crash-copy',
    loadLatestRemote: async () => ({
      meeting: { id: remote.meetingId, revision: remote.revision, checkpoint: remote }
    }),
    saveRemote: async (_meetingId, body) => {
      writes.push(copy(body))
      return { checkpoint: body.checkpoint }
    }
  })

  const restored = await checkpointer.loadLatest()
  assert.deepEqual(restored, local)
  assert.equal(checkpointer.revision, 3)

  const saved = await checkpointer.save({
    meetingId: restored.meetingId,
    status: 'paused',
    context: restored.context,
    meeting: restored.meeting
  })
  assert.equal(saved.revision, 4)
  assert.equal(writes[0].expectedRevision, 3)
  assert.equal(writes[0].checkpoint.context.artifacts.code, local.context.artifacts.code)
})

test('an authoritative empty active lookup does not resurrect a stale local meeting', async () => {
  const storage = memoryStorage()
  storage.setItem('terminal-copy', JSON.stringify(checkpointFixture({ revision: 9, label: 'already-terminal' })))
  const checkpointer = new MeetingCheckpointer({
    storage,
    storageKey: 'terminal-copy',
    loadLatestRemote: async () => ({ meeting: null })
  })

  assert.equal(await checkpointer.loadLatest(), null)
  assert.equal(storage.getItem('terminal-copy'), null)
})

test('a remote lookup outage keeps the complete local crash copy available in paused recovery', async () => {
  const storage = memoryStorage()
  const local = checkpointFixture({ revision: 7, label: 'offline-recovery' })
  storage.setItem('offline-copy', JSON.stringify(local))
  const outage = new Error('checkpoint server offline')
  const checkpointer = new MeetingCheckpointer({
    storage,
    storageKey: 'offline-copy',
    loadLatestRemote: async () => { throw outage }
  })

  assert.deepEqual(await checkpointer.loadLatest(), local)
  assert.equal(checkpointer.remoteLoadError, outage)
  assert.equal(checkpointer.revision, 7)
})

test('concurrent saves are serialized and advance optimistic revisions without overlap', async () => {
  const storage = memoryStorage()
  const calls = []
  let inFlight = 0
  let maxInFlight = 0
  const checkpointer = new MeetingCheckpointer({
    storage,
    saveRemote: async (meetingId, { checkpoint, expectedRevision }) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls.push({ meetingId, expectedRevision, revision: checkpoint.revision, node: checkpoint.cursor.node })
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      return { checkpoint }
    }
  })

  const states = ['research', 'concept', 'prd'].map(node => {
    const state = fullMeetingState(`concurrent-${node}`)
    state.context.cursor.node = node
    state.meeting.phase = node
    return state
  })
  const saves = states.map(({ context, meeting }) => checkpointer.save({
    meetingId: meeting.id,
    status: 'running',
    context,
    meeting
  }))
  const results = await Promise.all(saves)

  assert.deepEqual(results.map(result => result.revision), [1, 2, 3])
  assert.deepEqual(calls.map(call => [call.expectedRevision, call.revision, call.node]), [
    [0, 1, 'research'],
    [1, 2, 'concept'],
    [2, 3, 'prd']
  ])
  assert.equal(maxInFlight, 1)
  assert.equal(checkpointer.revision, 3)
  assert.equal(JSON.parse(storage.getItem('dotcade-active-meeting-checkpoint')).cursor.node, 'prd')
})

test('remote save failures propagate, preserve the local crash copy, and do not poison later writes', async () => {
  const storage = memoryStorage()
  const expectedRevisions = []
  let attempt = 0
  const checkpointer = new MeetingCheckpointer({
    storage,
    saveRemote: async (_meetingId, { checkpoint, expectedRevision }) => {
      expectedRevisions.push(expectedRevision)
      attempt++
      if (attempt === 1) throw new Error('checkpoint backend unavailable')
      return { checkpoint }
    }
  })
  const first = fullMeetingState('failed-write')

  await assert.rejects(
    checkpointer.save({ meetingId: first.meeting.id, status: 'pausing', ...first }),
    /backend unavailable/
  )
  assert.equal(checkpointer.revision, 0)
  const crashCopy = JSON.parse(storage.getItem('dotcade-active-meeting-checkpoint'))
  assert.equal(crashCopy.revision, 1)
  assert.equal(crashCopy.status, 'pausing')
  validateMeetingCheckpoint(crashCopy)

  const second = fullMeetingState('recovered-write')
  const recovered = await checkpointer.save({ meetingId: second.meeting.id, status: 'paused', ...second })
  assert.equal(recovered.revision, 1)
  assert.deepEqual(expectedRevisions, [0, 0])
})
