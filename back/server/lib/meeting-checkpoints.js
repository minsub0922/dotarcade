// Durable meeting workflow records, checkpoint validation and revision-CAS transitions.
// This module deliberately has no Express or filesystem dependency so the state
// contract can be exercised with ordinary objects in unit tests.

export const MEETING_CHECKPOINT_SCHEMA_VERSION = 1
export const MAX_MEETING_CHECKPOINT_BYTES = 3_500_000
export const MEETING_AGENT_IDS = Object.freeze(['pm', 'dev1', 'dev2', 'designer', 'writer'])

export const ACTIVE_MEETING_STATUSES = Object.freeze([
  'running',
  'pausing',
  'interrupting',
  'interrupted',
  'waiting_for_human',
  'paused',
  'resuming',
  'error'
])

const ACTIVE_STATUS_SET = new Set(ACTIVE_MEETING_STATUSES)
const TERMINAL_STATUS_SET = new Set(['done', 'cancelled'])
const RESUMABLE_STATUS_SET = new Set(['pausing', 'interrupting', 'interrupted', 'waiting_for_human', 'paused', 'error'])
const ALLOWED_STATUS_SET = new Set([
  ...ACTIVE_MEETING_STATUSES,
  'done',
  'cancelled'
])

export class MeetingCheckpointError extends Error {
  constructor(message, { status = 400, code = 'INVALID_MEETING_CHECKPOINT', details = null } = {}) {
    super(message)
    this.name = 'MeetingCheckpointError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const fail = (message, options) => { throw new MeetingCheckpointError(message, options) }
const nowIso = value => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  if (!Number.isFinite(date.getTime())) fail('유효한 저장 시각이 필요합니다')
  return date.toISOString()
}

function validateJsonValue(value, path = 'checkpoint', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path}에는 유한한 숫자만 저장할 수 있습니다`)
    return
  }
  if (typeof value !== 'object') fail(`${path}에 JSON으로 저장할 수 없는 값이 있습니다`)
  if (seen.has(value)) fail(`${path}에 순환 참조가 있습니다`)
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, seen))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${path}에는 plain JSON 객체만 저장할 수 있습니다`)
    }
    for (const [key, item] of Object.entries(value)) {
      validateJsonValue(item, `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

function jsonClone(value, { label = 'checkpoint', maxBytes = MAX_MEETING_CHECKPOINT_BYTES } = {}) {
  validateJsonValue(value, label)
  const encoded = JSON.stringify(value)
  const bytes = Buffer.byteLength(encoded, 'utf8')
  if (bytes > maxBytes) {
    fail(`${label}가 저장 한도(${maxBytes} bytes)를 초과했습니다`, {
      status: 413,
      code: 'MEETING_CHECKPOINT_TOO_LARGE',
      details: { bytes, maxBytes }
    })
  }
  return JSON.parse(encoded)
}

function normalizedStatus(value, fallback = 'running') {
  const status = value == null || value === '' ? fallback : String(value)
  if (!ALLOWED_STATUS_SET.has(status)) {
    fail(`지원하지 않는 회의 상태입니다: ${status}`, {
      code: 'INVALID_MEETING_STATUS',
      details: { status }
    })
  }
  return status
}

function revisionOf(meeting) {
  return Number.isInteger(meeting?.revision) && meeting.revision >= 0 ? meeting.revision : 0
}

function assertExpectedRevision(meeting, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    fail('expectedRevision은 0 이상의 정수여야 합니다', {
      code: 'EXPECTED_REVISION_REQUIRED'
    })
  }
  const actualRevision = revisionOf(meeting)
  if (expectedRevision !== actualRevision) {
    fail('회의 체크포인트 revision이 최신 상태와 다릅니다', {
      status: 409,
      code: 'MEETING_REVISION_CONFLICT',
      details: { expectedRevision, actualRevision }
    })
  }
  return actualRevision
}

function assertMutable(meeting) {
  const status = normalizedStatus(meeting.status, 'running')
  if (TERMINAL_STATUS_SET.has(status)) {
    fail(`종료된 회의(${status})는 변경할 수 없습니다`, {
      status: 409,
      code: 'MEETING_ALREADY_TERMINAL',
      details: { status }
    })
  }
}

function meetingAt(meetings, id) {
  if (!Array.isArray(meetings)) fail('meetings 저장소가 필요합니다', { status: 500, code: 'INVALID_MEETING_STORE' })
  const index = meetings.findIndex(item => item?.id === id)
  if (index < 0) {
    fail('회의를 찾을 수 없습니다', {
      status: 404,
      code: 'MEETING_NOT_FOUND',
      details: { id }
    })
  }
  return { meeting: meetings[index], index }
}

function replaceAt(meetings, index, meeting) {
  meetings[index] = meeting
  return meeting
}

function checkpointStatus(checkpoint, fallback) {
  return checkpoint?.status ?? checkpoint?.state?.status ?? fallback
}

const isPlainObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertCompleteCheckpoint(checkpoint) {
  const invalid = (message, details = null) => fail(message, {
    code: 'INCOMPLETE_MEETING_CHECKPOINT',
    details
  })
  if (checkpoint.schemaVersion !== MEETING_CHECKPOINT_SCHEMA_VERSION) {
    fail(`지원하지 않는 checkpoint schema입니다: ${checkpoint.schemaVersion}`, {
      code: 'INVALID_CHECKPOINT_SCHEMA_VERSION',
      details: { schemaVersion: checkpoint.schemaVersion, expected: MEETING_CHECKPOINT_SCHEMA_VERSION }
    })
  }
  if (!checkpoint.meetingId) invalid('checkpoint.meetingId가 필요합니다')
  if (!Number.isInteger(checkpoint.revision) || checkpoint.revision < 0) invalid('checkpoint.revision이 올바르지 않습니다')
  if (!isPlainObject(checkpoint.cursor) || !checkpoint.cursor.node) invalid('checkpoint.cursor가 완전하지 않습니다')
  if (!isPlainObject(checkpoint.context) || !isPlainObject(checkpoint.context.input)) {
    invalid('checkpoint.context가 완전하지 않습니다')
  }
  if (!isPlainObject(checkpoint.context.agents)) invalid('checkpoint agent context가 없습니다')
  for (const id of MEETING_AGENT_IDS) {
    const agent = checkpoint.context.agents[id]
    if (!isPlainObject(agent) || !Array.isArray(agent.messages) || !Array.isArray(agent.turns)) {
      invalid(`${id} agent의 전체 context가 없습니다`, { agentId: id })
    }
  }
  if (!Array.isArray(checkpoint.context.sharedMessages)) invalid('checkpoint sharedMessages가 없습니다')
  if (!Array.isArray(checkpoint.context.interventions)) invalid('checkpoint interventions가 없습니다')
  if (!isPlainObject(checkpoint.context.artifacts)) invalid('checkpoint artifacts가 없습니다')
  if (!isPlainObject(checkpoint.context.qa) || !Array.isArray(checkpoint.context.qa.history)) {
    invalid('checkpoint QA context가 없습니다')
  }
  if (!isPlainObject(checkpoint.meeting) || !Array.isArray(checkpoint.meeting.transcript)) {
    invalid('checkpoint meeting transcript가 없습니다')
  }
  if (checkpoint.meeting.id != null && checkpoint.meeting.id !== checkpoint.meetingId) {
    fail('checkpoint.meeting.id가 요청한 회의와 다릅니다', {
      code: 'CHECKPOINT_MEETING_MISMATCH',
      details: { checkpointMeetingId: checkpoint.meeting.id, meetingId: checkpoint.meetingId }
    })
  }
  return checkpoint
}

export function meetingCheckpointHash(checkpoint) {
  const source = JSON.stringify({
    schemaVersion: checkpoint?.schemaVersion,
    meetingId: checkpoint?.meetingId,
    revision: checkpoint?.revision,
    status: checkpoint?.status,
    cursor: checkpoint?.cursor,
    context: checkpoint?.context,
    meeting: checkpoint?.meeting
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function checkpointWithHash(checkpoint) {
  if (!checkpoint?.cursor || !checkpoint?.context || !checkpoint?.meeting) {
    if (checkpoint && 'contextHash' in checkpoint) {
      const copy = { ...checkpoint }
      delete copy.contextHash
      return copy
    }
    return checkpoint
  }
  return { ...checkpoint, contextHash: meetingCheckpointHash(checkpoint) }
}

function finalizeCheckpoint(checkpoint) {
  return jsonClone(checkpointWithHash(checkpoint))
}

function normalizeHumanIntervention(value, { id, phase = 'unknown', createdAt }) {
  if (value == null) return null
  const source = typeof value === 'string' ? { text: value } : value
  const copy = jsonClone(source, { label: 'intervention', maxBytes: 256_000 })
  const object = copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : { text: String(copy || '') }
  const text = String(object.text ?? object.message ?? '').trim()
  return {
    ...object,
    id: String(object.id || id),
    phase: String(object.phase || phase || 'unknown'),
    text,
    createdAt: String(object.createdAt || createdAt)
  }
}

function appendUnique(list, item) {
  const values = Array.isArray(list) ? [...list] : []
  if (!item || values.some(value => value?.id === item.id)) return values
  values.push(item)
  return values
}

function injectIntervention(checkpoint, intervention) {
  if (!checkpoint || !intervention) return checkpoint
  const next = structuredClone(checkpoint)
  if (next.context && typeof next.context === 'object') {
    next.context.interventions = appendUnique(next.context.interventions, intervention)
    const message = { ...intervention, role: 'user', kind: 'human-intervention' }
    next.context.sharedMessages = appendUnique(next.context.sharedMessages, message)
    for (const agent of Object.values(next.context.agents || {})) {
      if (!agent || typeof agent !== 'object') continue
      agent.messages = appendUnique(agent.messages, message)
    }
  }
  if (next.meeting && typeof next.meeting === 'object') {
    next.meeting.interventions = appendUnique(next.meeting.interventions, intervention)
  }
  return finalizeCheckpoint(next)
}

function normalizeCheckpoint(checkpoint, { meetingId, revision, status, savedAt }) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    fail('checkpoint 객체가 필요합니다', { code: 'CHECKPOINT_REQUIRED' })
  }
  const copy = jsonClone(checkpoint)
  if (copy.meetingId != null && copy.meetingId !== meetingId) {
    fail('checkpoint.meetingId가 요청한 회의와 다릅니다', {
      code: 'CHECKPOINT_MEETING_MISMATCH',
      details: { checkpointMeetingId: copy.meetingId, meetingId }
    })
  }
  if (copy.contextHash && copy.contextHash !== meetingCheckpointHash(copy)) {
    fail('checkpoint contextHash가 저장 내용과 일치하지 않습니다', {
      code: 'CHECKPOINT_HASH_MISMATCH'
    })
  }
  const normalized = {
    ...copy,
    schemaVersion: copy.schemaVersion || MEETING_CHECKPOINT_SCHEMA_VERSION,
    meetingId,
    revision,
    status: normalizedStatus(status, 'running'),
    savedAt
  }
  normalized.meeting = { ...normalized.meeting, id: meetingId, status: normalized.status }
  assertCompleteCheckpoint(normalized)
  return finalizeCheckpoint(normalized)
}

function syncCheckpoint(meeting, { revision, status, savedAt, patch = null }) {
  const current = meeting.checkpoint && typeof meeting.checkpoint === 'object'
    ? meeting.checkpoint
    : { schemaVersion: MEETING_CHECKPOINT_SCHEMA_VERSION, meetingId: meeting.id }
  const next = {
    ...current,
    ...(patch || {}),
    schemaVersion: current.schemaVersion || MEETING_CHECKPOINT_SCHEMA_VERSION,
    meetingId: meeting.id,
    revision,
    status,
    savedAt
  }
  if (next.meeting && typeof next.meeting === 'object' && !Array.isArray(next.meeting)) {
    next.meeting = { ...next.meeting, status }
  }
  return finalizeCheckpoint(next)
}

function transition(meetings, id, expectedRevision, updater, { now = Date.now() } = {}) {
  const { meeting, index } = meetingAt(meetings, id)
  const revision = assertExpectedRevision(meeting, expectedRevision)
  assertMutable(meeting)
  const savedAt = nowIso(now)
  const nextRevision = revision + 1
  const next = updater({ ...meeting }, { savedAt, nextRevision })
  next.revision = nextRevision
  next.updatedAt = savedAt
  return replaceAt(meetings, index, next)
}

export function createMeetingRecord(input, { id, now = Date.now() } = {}) {
  if (!id || typeof id !== 'string') fail('회의 id가 필요합니다', { code: 'MEETING_ID_REQUIRED' })
  const agenda = String(input?.agenda || '').trim()
  if (!agenda) fail('agenda 필요', { code: 'MEETING_AGENDA_REQUIRED' })
  if (agenda.length > 1800) fail('agenda는 1800자 이하여야 합니다', { code: 'MEETING_AGENDA_TOO_LONG' })
  const startedAt = nowIso(now)
  const type = input?.type === 'upgrade' ? 'upgrade' : 'new'
  const gameId = input?.gameId == null || input.gameId === '' ? null : String(input.gameId)
  const status = 'running'
  const revision = 0
  return {
    id,
    agenda,
    gameId,
    type,
    status,
    revision,
    startedAt,
    updatedAt: startedAt,
    interventions: [],
    checkpoint: null
  }
}

export function getMeetingRecord(meetings, id) {
  return meetingAt(meetings, id).meeting
}

export function getActiveMeetingRecord(meetings) {
  if (!Array.isArray(meetings)) return null
  let selected = null
  let selectedTime = -1
  for (let index = 0; index < meetings.length; index++) {
    const meeting = meetings[index]
    const status = meeting?.status || (meeting?.checkpoint ? meeting.checkpoint.status : null)
    if (!ACTIVE_STATUS_SET.has(status)) continue
    const time = new Date(meeting.updatedAt || meeting.startedAt || 0).getTime()
    const sortableTime = Number.isFinite(time) ? time : 0
    if (!selected || sortableTime >= selectedTime) {
      selected = meeting
      selectedTime = sortableTime
    }
  }
  return selected
}

export function createMeetingInStore(meetings, input, options = {}) {
  if (!Array.isArray(meetings)) fail('회의 저장소가 올바르지 않습니다', { code: 'INVALID_MEETING_STORE' })
  const active = getActiveMeetingRecord(meetings)
  if (active) {
    fail('이미 진행 중이거나 재개 가능한 회의가 있습니다', {
      status: 409,
      code: 'ACTIVE_MEETING_EXISTS',
      details: { meetingId: active.id, status: active.status }
    })
  }
  const record = createMeetingRecord(input, options)
  meetings.push(record)
  return record
}

export function commitMeetingMutation(db, operation) {
  if (!db?.data || !Array.isArray(db.data.meetings) || typeof db.flush !== 'function') {
    fail('동기 flush를 지원하는 회의 저장소가 필요합니다', {
      status: 500,
      code: 'INVALID_MEETING_STORE'
    })
  }
  const before = structuredClone(db.data.meetings)
  try {
    const result = operation(db.data.meetings)
    // Returning from this function is the durability acknowledgement boundary.
    db.flush()
    return result
  } catch (error) {
    db.data.meetings = before
    throw error
  }
}

export function putMeetingCheckpoint(meetings, id, { checkpoint, expectedRevision }, options = {}) {
  return transition(meetings, id, expectedRevision, (meeting, { savedAt, nextRevision }) => {
    const status = normalizedStatus(checkpointStatus(checkpoint, meeting.status), meeting.status || 'running')
    const normalized = normalizeCheckpoint(checkpoint, {
      meetingId: id,
      revision: nextRevision,
      status,
      savedAt
    })
    return {
      ...meeting,
      status,
      phase: normalized.phase ?? normalized.state?.phase ?? meeting.phase,
      phaseLabel: normalized.phaseLabel ?? normalized.state?.phaseLabel ?? meeting.phaseLabel,
      checkpoint: normalized
    }
  }, options)
}

export function interruptMeetingRecord(meetings, id, { expectedRevision, intervention = null }, options = {}) {
  const { meeting } = meetingAt(meetings, id)
  assertExpectedRevision(meeting, expectedRevision)
  if (!meeting.checkpoint?.cursor || !meeting.checkpoint?.context || !meeting.checkpoint?.meeting) {
    fail('첫 전체 체크포인트가 저장되기 전에는 회의를 중단할 수 없습니다', {
      status: 409,
      code: 'MEETING_CHECKPOINT_NOT_READY'
    })
  }
  return transition(meetings, id, expectedRevision, (meeting, { savedAt, nextRevision }) => {
    const entry = normalizeHumanIntervention(intervention, {
      id: `${id}:intervention:${nextRevision}`,
      phase: meeting.checkpoint?.cursor?.node || meeting.phase || 'unknown',
      createdAt: savedAt
    })
    const interventions = entry ? [...(meeting.interventions || []), entry] : [...(meeting.interventions || [])]
    const interrupt = { requestedAt: savedAt, interventionId: entry?.id || null }
    // The durable control request is resumable immediately, while the runner may
    // still be aborting its current atomic operation at a safe boundary.
    const status = 'pausing'
    return {
      ...meeting,
      status,
      interrupt,
      intervention: entry,
      interventions,
      checkpoint: injectIntervention(syncCheckpoint(meeting, {
        revision: nextRevision,
        status,
        savedAt,
        patch: { interrupt }
      }), entry)
    }
  }, options)
}

export function resumeMeetingRecord(meetings, id, { expectedRevision }, options = {}) {
  const { meeting } = meetingAt(meetings, id)
  assertExpectedRevision(meeting, expectedRevision)
  const currentStatus = normalizedStatus(meeting.status, 'running')
  if (!RESUMABLE_STATUS_SET.has(currentStatus)) {
    fail(`현재 상태(${currentStatus})에서는 회의를 재개할 수 없습니다`, {
      status: 409,
      code: 'MEETING_NOT_RESUMABLE',
      details: { status: currentStatus }
    })
  }
  return transition(meetings, id, expectedRevision, (next, { savedAt, nextRevision }) => {
    const status = 'running'
    return {
      ...next,
      status,
      interrupt: null,
      intervention: null,
      resumedAt: savedAt,
      checkpoint: syncCheckpoint(next, {
        revision: nextRevision,
        status,
        savedAt,
        patch: { interrupt: null, intervention: null, resumedAt: savedAt }
      })
    }
  }, options)
}

export function cancelMeetingRecord(meetings, id, { expectedRevision }, options = {}) {
  return transition(meetings, id, expectedRevision, (meeting, { savedAt, nextRevision }) => {
    const status = 'cancelled'
    return {
      ...meeting,
      status,
      cancelledAt: savedAt,
      interrupt: null,
      intervention: null,
      checkpoint: syncCheckpoint(meeting, {
        revision: nextRevision,
        status,
        savedAt,
        patch: { interrupt: null, intervention: null, cancelledAt: savedAt }
      })
    }
  }, options)
}

// Compatibility path for the original client, which PATCHes only once at release.
// Reserved checkpoint identity fields cannot be overwritten through this route.
export function patchMeetingRecord(meetings, id, patch, { expectedRevision, now = Date.now() } = {}) {
  const { meeting, index } = meetingAt(meetings, id)
  const currentRevision = revisionOf(meeting)
  // Revision zero is the compatibility window for the original create→final PATCH
  // client. Once checkpointing starts, every writer must participate in CAS.
  if (expectedRevision == null && currentRevision > 0) {
    fail('checkpoint가 시작된 회의 PATCH에는 expectedRevision이 필요합니다', {
      code: 'EXPECTED_REVISION_REQUIRED',
      details: { actualRevision: currentRevision }
    })
  }
  if (expectedRevision != null) assertExpectedRevision(meeting, expectedRevision)
  const copy = jsonClone(patch || {}, { label: 'meeting patch' })
  for (const key of ['id', 'revision', 'checkpoint', 'interventions', 'startedAt']) delete copy[key]
  const savedAt = nowIso(now)
  const currentStatus = normalizedStatus(meeting.status, 'running')
  const requestedStatus = normalizedStatus(copy.status, currentStatus)
  if (TERMINAL_STATUS_SET.has(currentStatus)) {
    const changedKeys = Object.keys(copy)
      .filter(key => key !== 'status')
      .filter(key => JSON.stringify(copy[key]) !== JSON.stringify(meeting[key]))
    if (requestedStatus !== currentStatus || changedKeys.length) {
      fail(`종료된 회의(${currentStatus})는 변경할 수 없습니다`, {
        status: 409,
        code: 'MEETING_ALREADY_TERMINAL',
        details: { status: currentStatus, requestedStatus, changedKeys }
      })
    }
    // Exact terminal retries are reads, not new revisions.
    return meeting
  }
  const revision = currentRevision + 1
  const status = requestedStatus
  const next = {
    ...meeting,
    ...copy,
    status,
    revision,
    updatedAt: savedAt,
    checkpoint: syncCheckpoint(meeting, { revision, status, savedAt })
  }
  return replaceAt(meetings, index, next)
}

export function findGameByMeeting(games, meetingId) {
  if (!meetingId || !Array.isArray(games)) return null
  return games.find(game => Array.isArray(game?.meetings) && game.meetings.includes(meetingId)) || null
}

export function findVersionByMeeting(game, meetingId) {
  if (!meetingId || !Array.isArray(game?.versions)) return null
  return game.versions.find(version => version?.meetingId === meetingId) || null
}

export function inspectGameCreation(games, { meetingId = null, gameId } = {}) {
  const byMeeting = findGameByMeeting(games, meetingId)
  if (byMeeting) return { action: 'existing', game: byMeeting, reason: 'meeting' }
  const byId = Array.isArray(games) ? games.find(game => game?.id === gameId) : null
  if (!byId) return { action: 'create' }
  if (meetingId && byId.meetings?.includes(meetingId)) {
    return { action: 'existing', game: byId, reason: 'meeting-and-id' }
  }
  return { action: 'conflict', game: byId, reason: 'id' }
}

export function inspectVersionRelease(game, { meetingId = null, version } = {}) {
  const byMeeting = findVersionByMeeting(game, meetingId)
  if (byMeeting) return { action: 'existing', version: byMeeting, reason: 'meeting' }
  const byVersion = Array.isArray(game?.versions)
    ? game.versions.find(item => item?.v === version)
    : null
  if (!byVersion) return { action: 'create' }
  if (meetingId && game?.meetings?.includes(meetingId)) {
    return { action: 'existing', version: byVersion, reason: 'legacy-meeting-ledger' }
  }
  return { action: 'conflict', version: byVersion, reason: 'version' }
}
