import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MeetingCheckpointError,
  cancelMeetingRecord,
  commitMeetingMutation,
  createMeetingInStore,
  createMeetingRecord,
  findGameByMeeting,
  findVersionByMeeting,
  getActiveMeetingRecord,
  getMeetingRecord,
  inspectGameCreation,
  inspectVersionRelease,
  interruptMeetingRecord,
  meetingCheckpointHash,
  patchMeetingRecord,
  putMeetingCheckpoint,
  resumeMeetingRecord
} from './meeting-checkpoints.js'

const T0 = '2026-08-26T01:00:00.000Z'
const T1 = '2026-08-26T01:01:00.000Z'
const T2 = '2026-08-26T01:02:00.000Z'
const AGENT_IDS = ['pm', 'dev1', 'dev2', 'designer', 'writer']

const fresh = () => [createMeetingRecord(
  { agenda: '멀티에이전트 회의 복원', type: 'new' },
  { id: 'meeting-1', now: T0 }
)]

const hashedCheckpoint = ({ revision = 1, status = 'paused' } = {}) => {
  const checkpoint = {
    schemaVersion: 1,
    meetingId: 'meeting-1',
    revision,
    status,
    savedAt: T1,
    cursor: { node: 'concept', round: 1 },
    context: {
      input: { agenda: '멀티에이전트 회의 복원' },
      agents: Object.fromEntries(AGENT_IDS.map(id => [id, { messages: [], turns: [] }])),
      sharedMessages: [], interventions: [], artifacts: {}, qa: { history: [] }
    },
    meeting: { id: 'meeting-1', status, transcript: [] }
  }
  checkpoint.contextHash = meetingCheckpointHash(checkpoint)
  return checkpoint
}

const expectCheckpointError = (fn, { status, code }) => {
  assert.throws(fn, error => {
    assert.ok(error instanceof MeetingCheckpointError)
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    return true
  })
}

test('new meeting starts at revision zero and waits for the first complete client checkpoint', () => {
  const meeting = fresh()[0]
  assert.equal(meeting.status, 'running')
  assert.equal(meeting.revision, 0)
  assert.equal(meeting.checkpoint, null)
  assert.deepEqual(meeting.interventions, [])

  const meetings = [meeting]
  expectCheckpointError(() => interruptMeetingRecord(meetings, 'meeting-1', {
    expectedRevision: 0,
    intervention: { text: '아직 복원 컨텍스트가 없는 시점의 개입' }
  }), { status: 409, code: 'MEETING_CHECKPOINT_NOT_READY' })
  assert.equal(meetings[0].revision, 0)
  assert.equal(meetings[0].checkpoint, null)
})

test('a profile cannot create a second meeting while one remains resumable', () => {
  const meetings = fresh()
  expectCheckpointError(() => createMeetingInStore(
    meetings,
    { agenda: '동시에 만들면 안 되는 두 번째 회의' },
    { id: 'meeting-2', now: T1 }
  ), { status: 409, code: 'ACTIVE_MEETING_EXISTS' })
  assert.equal(meetings.length, 1)

  const cancelled = cancelMeetingRecord(meetings, 'meeting-1', { expectedRevision: 0 }, { now: T1 })
  assert.equal(cancelled.status, 'cancelled')
  const created = createMeetingInStore(
    meetings,
    { agenda: '종료 후 새 회의' },
    { id: 'meeting-2', now: T2 }
  )
  assert.equal(created.id, 'meeting-2')
  assert.equal(meetings.length, 2)
})

test('checkpoint CAS preserves the complete multi-agent context without truncation', () => {
  const meetings = fresh()
  const longTranscript = '가'.repeat(12_000)
  const checkpoint = hashedCheckpoint({ revision: 1, status: 'running' })
  checkpoint.cursor = { node: 'concept', round: 2, agentIndex: 3, qaAttempt: 0 }
  checkpoint.context.agents = Object.fromEntries([
    ['pm', 'PRD 원문'], ['dev1', '설계 원문'], ['dev2', '구현 원문'],
    ['designer', '디자인 원문'], ['writer', '서사 원문']
  ].map(([id, text]) => [id, { messages: [{ role: 'assistant', text }], turns: [] }]))
  checkpoint.context.research = { corpus: ['검색 원문'], sources: [{ url: 'https://example.com/evidence' }] }
  checkpoint.context.artifacts = { prd: '# PRD', design: '# Design', arch: '# Architecture', code: 'window.game={}' }
  checkpoint.context.qa = { attempt: 1, diagnostics: { pass: false, issues: ['repair'] }, history: [] }
  checkpoint.context.interventions = [{ text: '조작감을 우선해 주세요.' }]
  checkpoint.meeting.transcript = [{ id: 'turn-1', text: longTranscript }]
  checkpoint.contextHash = meetingCheckpointHash(checkpoint)

  const meeting = putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint
  }, { now: T1 })

  assert.equal(meeting.revision, 1)
  assert.equal(meeting.checkpoint.revision, 1)
  assert.equal(meeting.checkpoint.cursor.node, 'concept')
  assert.equal(meeting.checkpoint.meeting.transcript[0].text.length, 12_000)
  assert.equal(Object.keys(meeting.checkpoint.context.agents).length, 5)
  assert.equal(meeting.checkpoint.context.artifacts.code, 'window.game={}')
  assert.deepEqual(getMeetingRecord(meetings, 'meeting-1'), meeting)
})

test('a latest-revision partial checkpoint cannot overwrite the complete agent context', () => {
  const meetings = fresh()
  putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: hashedCheckpoint({ revision: 1, status: 'running' })
  }, { now: T1 })
  const before = structuredClone(meetings[0])

  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 1,
    checkpoint: { schemaVersion: 1, status: 'paused', state: { phase: 'research' } }
  }, { now: T2 }), { status: 400, code: 'INCOMPLETE_MEETING_CHECKPOINT' })
  assert.deepEqual(meetings[0], before)
})

test('stale or missing revisions fail without changing the stored checkpoint', () => {
  const meetings = fresh()
  putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: hashedCheckpoint({ revision: 1, status: 'running' })
  }, { now: T1 })
  const before = structuredClone(meetings[0])

  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: { state: { phase: 'concept' } }
  }), { status: 409, code: 'MEETING_REVISION_CONFLICT' })
  expectCheckpointError(() => interruptMeetingRecord(meetings, 'meeting-1', {}), {
    status: 400,
    code: 'EXPECTED_REVISION_REQUIRED'
  })
  assert.deepEqual(meetings[0], before)
})

test('storage transaction flushes synchronously before acknowledgement and rolls back on failure', () => {
  let flushes = 0
  const db = {
    data: { meetings: fresh() },
    flush() { flushes++ }
  }
  const saved = commitMeetingMutation(db, meetings => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: hashedCheckpoint({ revision: 1, status: 'running' })
  }, { now: T1 }))
  assert.equal(flushes, 1)
  assert.equal(saved.revision, 1)
  assert.equal(db.data.meetings[0].revision, 1)

  const durable = structuredClone(db.data.meetings)
  db.flush = () => { throw new Error('disk full') }
  assert.throws(() => commitMeetingMutation(db, meetings => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 1,
    checkpoint: hashedCheckpoint({ revision: 2, status: 'running' })
  }, { now: T2 })), /disk full/)
  assert.deepEqual(db.data.meetings, durable)
})

test('interrupt and resume keep the checkpoint and durable human intervention ledger', () => {
  const meetings = fresh()
  const checkpoint = hashedCheckpoint({ revision: 1, status: 'running' })
  checkpoint.state = { phase: 'impl', artifacts: { code: 'const before = true' } }
  checkpoint.contextHash = meetingCheckpointHash(checkpoint)
  putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint
  }, { now: T1 })

  const interrupted = interruptMeetingRecord(meetings, 'meeting-1', {
    expectedRevision: 1,
    intervention: { text: '점프 높이를 낮추고 현재 구현 노드를 다시 실행해 주세요.', target: 'all' }
  }, { now: T2 })
  assert.equal(interrupted.status, 'pausing')
  assert.equal(interrupted.revision, 2)
  assert.equal(interrupted.interventions.length, 1)
  assert.equal(interrupted.intervention.id, interrupted.interventions[0].id)
  assert.equal(interrupted.interventions[0].target, 'all')
  assert.equal(interrupted.checkpoint.state.artifacts.code, 'const before = true')

  const resumed = resumeMeetingRecord(meetings, 'meeting-1', { expectedRevision: 2 }, {
    now: '2026-08-26T01:03:00.000Z'
  })
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.revision, 3)
  assert.equal(resumed.interrupt, null)
  assert.equal(resumed.intervention, null)
  assert.equal(resumed.interventions.length, 1)
  assert.equal(resumed.checkpoint.state.artifacts.code, 'const before = true')
})

test('frontend checkpoint hashes remain valid through pausing and server control transitions', () => {
  const meetings = fresh()
  const pausing = putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: hashedCheckpoint({ revision: 1, status: 'pausing' })
  }, { now: T1 })
  assert.equal(pausing.status, 'pausing')
  assert.equal(pausing.checkpoint.contextHash, meetingCheckpointHash(pausing.checkpoint))

  const interrupted = interruptMeetingRecord(meetings, 'meeting-1', {
    expectedRevision: 1,
    intervention: { text: 'human direction' }
  }, { now: T2 })
  assert.equal(interrupted.checkpoint.contextHash, meetingCheckpointHash(interrupted.checkpoint))
  assert.equal(interrupted.checkpoint.meeting.status, 'pausing')
  assert.equal(interrupted.checkpoint.context.interventions[0].text, 'human direction')
  assert.equal(interrupted.checkpoint.context.sharedMessages[0].kind, 'human-intervention')
  for (const id of AGENT_IDS) {
    assert.equal(interrupted.checkpoint.context.agents[id].messages[0].text, 'human direction')
  }

  const resumed = resumeMeetingRecord(meetings, 'meeting-1', { expectedRevision: 2 }, {
    now: '2026-08-26T01:03:00.000Z'
  })
  assert.equal(resumed.checkpoint.contextHash, meetingCheckpointHash(resumed.checkpoint))
  assert.equal(resumed.checkpoint.meeting.status, 'running')

  const done = patchMeetingRecord(meetings, 'meeting-1', { status: 'done' }, {
    expectedRevision: 3,
    now: '2026-08-26T01:04:00.000Z'
  })
  assert.equal(done.checkpoint.contextHash, meetingCheckpointHash(done.checkpoint))
  assert.equal(done.checkpoint.meeting.status, 'done')
})

test('tampered frontend context hashes are rejected before storage', () => {
  const meetings = fresh()
  const checkpoint = hashedCheckpoint()
  checkpoint.context.input.agenda = 'tampered after hashing'
  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint
  }), { status: 400, code: 'CHECKPOINT_HASH_MISMATCH' })
  assert.equal(meetings[0].revision, 0)
})

test('an intervention cannot grow a valid checkpoint beyond the durable size limit', () => {
  const meetings = fresh()
  const checkpoint = hashedCheckpoint({ revision: 1, status: 'paused' })
  checkpoint.context.artifacts.code = 'x'.repeat(3_150_000)
  checkpoint.contextHash = meetingCheckpointHash(checkpoint)
  putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint
  }, { now: T1 })
  const before = structuredClone(meetings[0])

  expectCheckpointError(() => interruptMeetingRecord(meetings, 'meeting-1', {
    expectedRevision: 1,
    intervention: { text: '지'.repeat(100_000) }
  }, { now: T2 }), { status: 413, code: 'MEETING_CHECKPOINT_TOO_LARGE' })
  assert.deepEqual(meetings[0], before)
})

test('active meeting lookup selects the newest resumable workflow only', () => {
  const older = createMeetingRecord({ agenda: 'older' }, { id: 'older', now: T0 })
  const done = patchMeetingRecord([createMeetingRecord({ agenda: 'done' }, { id: 'done', now: T0 })], 'done', {
    status: 'done'
  }, { now: T1 })
  const newer = createMeetingRecord({ agenda: 'newer' }, { id: 'newer', now: T2 })
  assert.equal(getActiveMeetingRecord([older, done, newer]).id, 'newer')

  const onlyTerminal = [done, cancelMeetingRecord(
    [createMeetingRecord({ agenda: 'cancel' }, { id: 'cancel', now: T0 })],
    'cancel',
    { expectedRevision: 0 },
    { now: T1 }
  )]
  assert.equal(getActiveMeetingRecord(onlyTerminal), null)
})

test('cancel is terminal and a checkpoint cannot resurrect it', () => {
  const meetings = fresh()
  const cancelled = cancelMeetingRecord(meetings, 'meeting-1', { expectedRevision: 0 }, { now: T1 })
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.checkpoint.status, 'cancelled')

  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 1,
    checkpoint: { status: 'running', state: {} }
  }), { status: 409, code: 'MEETING_ALREADY_TERMINAL' })
  expectCheckpointError(() => patchMeetingRecord(meetings, 'meeting-1', {
    status: 'done'
  }, { expectedRevision: 1 }), { status: 409, code: 'MEETING_ALREADY_TERMINAL' })
  expectCheckpointError(() => patchMeetingRecord(meetings, 'meeting-1', {
    agenda: 'cancel 뒤에는 바뀌면 안 됨'
  }, { expectedRevision: 1 }), { status: 409, code: 'MEETING_ALREADY_TERMINAL' })
  const retry = patchMeetingRecord(meetings, 'meeting-1', {
    status: 'cancelled'
  }, { expectedRevision: 1 })
  assert.equal(retry.revision, 1)
  assert.equal(retry.agenda, '멀티에이전트 회의 복원')
})

test('legacy final PATCH works at revision zero but joins CAS after checkpointing starts', () => {
  const legacyMeetings = fresh()
  const done = patchMeetingRecord(legacyMeetings, 'meeting-1', { status: 'done' }, { now: T1 })
  assert.equal(done.status, 'done')
  assert.equal(done.revision, 1)

  const checkpointedMeetings = fresh()
  putMeetingCheckpoint(checkpointedMeetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: hashedCheckpoint({ revision: 1, status: 'running' })
  }, { now: T1 })
  expectCheckpointError(() => patchMeetingRecord(checkpointedMeetings, 'meeting-1', {
    status: 'done'
  }), { status: 400, code: 'EXPECTED_REVISION_REQUIRED' })
  const checkpointedDone = patchMeetingRecord(checkpointedMeetings, 'meeting-1', {
    status: 'done'
  }, { expectedRevision: 1, now: T2 })
  assert.equal(checkpointedDone.status, 'done')
  assert.equal(checkpointedDone.revision, 2)
})

test('checkpoint validation rejects mismatched meeting identity and non-JSON state', () => {
  const meetings = fresh()
  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: { meetingId: 'another-meeting', state: {} }
  }), { status: 400, code: 'CHECKPOINT_MEETING_MISMATCH' })

  const circular = { state: {} }
  circular.state.circular = circular
  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: circular
  }), { status: 400, code: 'INVALID_MEETING_CHECKPOINT' })
  expectCheckpointError(() => putMeetingCheckpoint(meetings, 'meeting-1', {
    expectedRevision: 0,
    checkpoint: { state: { lossyMap: new Map([['agent', 'context']]) } }
  }), { status: 400, code: 'INVALID_MEETING_CHECKPOINT' })
})

test('release lookup identifies a game and exact version already produced by a meeting', () => {
  const games = [{
    id: 'game-1',
    meetings: ['meeting-create', 'meeting-upgrade'],
    versions: [
      { v: 'v1.0.0', meetingId: 'meeting-create' },
      { v: 'v1.1.0', meetingId: 'meeting-upgrade' }
    ]
  }]
  assert.equal(findGameByMeeting(games, 'meeting-create'), games[0])
  assert.equal(findVersionByMeeting(games[0], 'meeting-upgrade').v, 'v1.1.0')
  assert.equal(findGameByMeeting(games, 'missing'), null)
  assert.equal(findVersionByMeeting(games[0], 'missing'), null)
})

test('release decisions distinguish retry idempotency from real id and version conflicts', () => {
  const game = {
    id: 'game-1',
    meetings: ['meeting-create', 'legacy-upgrade'],
    versions: [
      { v: 'v1.0.0', meetingId: 'meeting-create' },
      { v: 'v1.1.0' }
    ]
  }

  assert.equal(inspectGameCreation([game], {
    meetingId: 'meeting-create', gameId: 'another-generated-id'
  }).action, 'existing')
  assert.equal(inspectGameCreation([game], {
    meetingId: 'different-meeting', gameId: 'game-1'
  }).action, 'conflict')
  assert.equal(inspectGameCreation([game], {
    meetingId: 'new-meeting', gameId: 'game-2'
  }).action, 'create')

  const legacy = inspectVersionRelease(game, { meetingId: 'legacy-upgrade', version: 'v1.1.0' })
  assert.equal(legacy.action, 'existing')
  assert.equal(legacy.reason, 'legacy-meeting-ledger')
  assert.equal(inspectVersionRelease(game, {
    meetingId: 'different-upgrade', version: 'v1.1.0'
  }).action, 'conflict')
  assert.equal(inspectVersionRelease(game, {
    meetingId: 'new-upgrade', version: 'v1.2.0'
  }).action, 'create')
})
