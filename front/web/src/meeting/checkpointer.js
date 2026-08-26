// DOTCADE meeting checkpointer
//
// A checkpoint is deliberately plain JSON. Promises, timers, AbortControllers and
// DOM nodes belong to the runner; everything needed to rebuild the multi-agent
// run belongs here.

export const MEETING_CHECKPOINT_SCHEMA_VERSION = 1
export const MEETING_AGENT_IDS = ['pm', 'dev1', 'dev2', 'designer', 'writer']
export const RESUMABLE_MEETING_STATUSES = new Set([
  'running', 'pausing', 'paused', 'resuming',
  // Server control endpoints use these explicit transition aliases.
  'interrupting', 'interrupted', 'waiting_for_human', 'error'
])

const clone = value => value == null
  ? value
  : (typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value)))

const isPlainObject = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function assertJsonValue(value, path = 'checkpoint', seen = new Set()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`)
    return
  }
  if (typeof value !== 'object') throw new Error(`${path} is not JSON serializable`)
  if (seen.has(value)) throw new Error(`${path} contains a circular reference`)
  seen.add(value)
  if (Array.isArray(value)) value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen))
  else {
    if (!isPlainObject(value)) throw new Error(`${path} contains a non-plain object`)
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`, seen)
  }
  seen.delete(value)
}

export function createAgentContexts() {
  return Object.fromEntries(MEETING_AGENT_IDS.map(id => [id, {
    messages: [],
    turns: [],
    research: { ragNotes: '', webNotes: '', sources: [] },
    note: ''
  }]))
}

export function createMeetingRunContext({
  agenda,
  upgradeGame = null,
  referenceSearch = false,
  referenceTarget = ''
}) {
  return {
    schemaVersion: MEETING_CHECKPOINT_SCHEMA_VERSION,
    input: {
      agenda: String(agenda || ''),
      upgradeGame: clone(upgradeGame),
      referenceSearch: !!referenceSearch,
      referenceTarget: String(referenceTarget || '')
    },
    cursor: {
      node: 'kickoff',
      researchAgentIndex: 0,
      debateRound: 1,
      debateAgentIndex: 0,
      documentIndex: 0,
      reviewAgentIndex: 0,
      qaAttempt: 0,
      releaseStep: 'pending'
    },
    agents: createAgentContexts(),
    sharedMessages: [],
    research: {
      corpus: [String(agenda || '')],
      result: null,
      referenceResult: null,
      referenceContext: '',
      referenceDesignContract: null
    },
    upgrade: { info: '', currentCode: '' },
    direction: null,
    artifacts: { prd: '', design: '', arch: '', code: '' },
    qa: { attempt: 0, diagnostics: null, pass: null, skipped: false, skippedAt: null, history: [] },
    interventions: [],
    pendingInterventions: [],
    gates: { direction: null, approval: null },
    effects: {
      gameSaved: null,
      ragSaved: false,
      meetingFinalized: false,
      rewardApplied: false
    }
  }
}

export function recordAgentExchange(context, agentId, {
  phase,
  kind = 'talk',
  input,
  output,
  sources = [],
  turnId = `${phase || 'turn'}:${Date.now()}`
}) {
  if (!MEETING_AGENT_IDS.includes(agentId)) throw new Error(`unknown meeting agent: ${agentId}`)
  const agent = context.agents[agentId]
  if (agent.turns.some(turn => turn.id === turnId)) return context
  const userMessage = { id: `${turnId}:input`, role: 'user', phase, kind, text: String(input || '') }
  const assistantMessage = {
    id: `${turnId}:output`, role: 'assistant', phase, kind,
    text: String(output || ''), sources: clone(sources || [])
  }
  agent.messages.push(userMessage, assistantMessage)
  agent.turns.push({ id: turnId, phase, kind, input: userMessage.text, output: assistantMessage.text, sources: assistantMessage.sources })
  return context
}

export function appendHumanIntervention(context, text, {
  id = `human:${Date.now()}`,
  phase = context.cursor?.node || 'unknown',
  createdAt = new Date().toISOString()
} = {}) {
  const normalized = String(text || '').trim()
  if (!normalized) return null
  const existing = context.interventions.find(item => item.id === id)
  if (existing) return existing
  const intervention = { id, phase, text: normalized, createdAt }
  context.interventions.push(intervention)
  context.sharedMessages.push({ ...intervention, role: 'user', kind: 'human-intervention' })
  for (const agentId of MEETING_AGENT_IDS) {
    context.agents[agentId].messages.push({
      ...intervention,
      role: 'user',
      kind: 'human-intervention'
    })
  }
  return intervention
}

export function humanInterventionContext(context) {
  if (!context?.interventions?.length) return ''
  return `[팀장 실시간 개입 — 이후 모든 결정에 반드시 반영]\n${context.interventions
    .map((item, index) => `${index + 1}. (${item.phase}) ${item.text}`)
    .join('\n')}`
}

export function checkpointHash(checkpoint) {
  const source = JSON.stringify({
    schemaVersion: checkpoint.schemaVersion,
    meetingId: checkpoint.meetingId,
    revision: checkpoint.revision,
    status: checkpoint.status,
    cursor: checkpoint.cursor,
    context: checkpoint.context,
    meeting: checkpoint.meeting
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createMeetingCheckpoint({
  meetingId,
  revision,
  status,
  context,
  meeting,
  savedAt = new Date().toISOString()
}) {
  const checkpoint = {
    schemaVersion: MEETING_CHECKPOINT_SCHEMA_VERSION,
    meetingId: String(meetingId || ''),
    revision: Number(revision) || 0,
    status: String(status || 'running'),
    savedAt,
    cursor: clone(context?.cursor || {}),
    context: clone(context),
    meeting: clone(meeting)
  }
  checkpoint.contextHash = checkpointHash(checkpoint)
  validateMeetingCheckpoint(checkpoint)
  return checkpoint
}

export function validateMeetingCheckpoint(checkpoint) {
  if (!isPlainObject(checkpoint)) throw new Error('meeting checkpoint must be an object')
  if (checkpoint.schemaVersion !== MEETING_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(`unsupported meeting checkpoint schema: ${checkpoint.schemaVersion}`)
  }
  if (!checkpoint.meetingId) throw new Error('meeting checkpoint requires meetingId')
  if (!Number.isInteger(checkpoint.revision) || checkpoint.revision < 0) throw new Error('meeting checkpoint revision is invalid')
  if (!isPlainObject(checkpoint.cursor) || !checkpoint.cursor.node) throw new Error('meeting checkpoint cursor is invalid')
  if (!isPlainObject(checkpoint.context) || !isPlainObject(checkpoint.context.input)) throw new Error('meeting checkpoint context is invalid')
  if (!isPlainObject(checkpoint.context.agents)) throw new Error('meeting checkpoint agent contexts are missing')
  for (const id of MEETING_AGENT_IDS) {
    const agent = checkpoint.context.agents[id]
    if (!isPlainObject(agent) || !Array.isArray(agent.messages) || !Array.isArray(agent.turns)) {
      throw new Error(`meeting checkpoint is missing full context for ${id}`)
    }
  }
  if (!Array.isArray(checkpoint.context.interventions)) throw new Error('meeting checkpoint interventions are missing')
  if (!isPlainObject(checkpoint.context.artifacts)) throw new Error('meeting checkpoint artifacts are missing')
  if (!isPlainObject(checkpoint.context.qa) || !Array.isArray(checkpoint.context.qa.history)) throw new Error('meeting checkpoint QA context is missing')
  if (!isPlainObject(checkpoint.meeting) || !Array.isArray(checkpoint.meeting.transcript)) throw new Error('meeting checkpoint transcript is missing')
  assertJsonValue(checkpoint)
  const expectedHash = checkpointHash(checkpoint)
  if (checkpoint.contextHash && checkpoint.contextHash !== expectedHash) throw new Error('meeting checkpoint context hash mismatch')
  return checkpoint
}

export function hydrateMeetingCheckpoint(checkpoint) {
  validateMeetingCheckpoint(checkpoint)
  return clone(checkpoint)
}

function getStorage(fallback) {
  if (fallback) return fallback
  try { return globalThis.localStorage || null } catch { return null }
}

export class MeetingCheckpointer {
  constructor({
    saveRemote,
    loadLatestRemote,
    loadRemote,
    storage,
    storageKey = 'dotcade-active-meeting-checkpoint'
  } = {}) {
    this.saveRemote = saveRemote
    this.loadLatestRemote = loadLatestRemote
    this.loadRemote = loadRemote
    this.storage = getStorage(storage)
    this.storageKey = storageKey
    this.revision = 0
    this.last = null
    this.remoteLoadError = null
    this._writes = Promise.resolve()
  }

  async save({ meetingId, status, context, meeting }) {
    const operation = this._writes.then(async () => {
      const expectedRevision = this.revision
      let checkpoint = createMeetingCheckpoint({
        meetingId,
        revision: expectedRevision + 1,
        status,
        context,
        meeting
      })
      // Keep a local crash copy even when the network write fails. The caller
      // still receives the error and must stop advancing the workflow.
      this._writeLocal(checkpoint)
      if (this.saveRemote) {
        const response = await this.saveRemote(meetingId, { checkpoint, expectedRevision })
        checkpoint = hydrateMeetingCheckpoint(response?.checkpoint || response?.meeting?.checkpoint || checkpoint)
      }
      this.revision = checkpoint.revision
      this.last = checkpoint
      this._writeLocal(checkpoint)
      return clone(checkpoint)
    })
    this._writes = operation.catch(() => {})
    return operation
  }

  async loadLatest() {
    let remoteResult = null
    let remoteCheckpoint = null
    if (this.loadLatestRemote) {
      try {
        remoteResult = await this.loadLatestRemote()
        this.remoteLoadError = null
        remoteCheckpoint = remoteResult?.checkpoint || remoteResult?.meeting?.checkpoint || null
      } catch (error) {
        // Keep the last fully serialized crash copy visible while offline. The
        // runner will remain paused because its next durability write still has
        // to receive a server ACK before work may continue.
        this.remoteLoadError = error
      }
    }
    const localCheckpoint = this._readLocal()

    // A successful active-meeting lookup is authoritative. Do not resurrect a
    // stale local crash copy after the server has already completed/cancelled it,
    // nor let a previous meeting outrank the current active record.
    if (this.loadLatestRemote && remoteResult && 'meeting' in remoteResult && !remoteResult.meeting && !remoteCheckpoint) {
      this.clearLocal()
      return null
    }
    const activeMeetingId = remoteResult?.meeting?.id || remoteCheckpoint?.meetingId || null
    const eligibleLocal = !activeMeetingId || localCheckpoint?.meetingId === activeMeetingId
      ? localCheckpoint
      : null
    const candidates = [remoteCheckpoint, eligibleLocal].filter(Boolean)
    if (!candidates.length) {
      if (this.remoteLoadError) throw this.remoteLoadError
      return null
    }
    const checkpoint = candidates
      .map(hydrateMeetingCheckpoint)
      .sort((a, b) => b.revision - a.revision || String(b.savedAt).localeCompare(String(a.savedAt)))[0]

    // localStorage is written before the remote acknowledgement. After a tab or
    // process crash it can legitimately be one revision ahead. Resume from that
    // richer payload, but use the server's authoritative revision for the next
    // CAS so the crash copy can be committed instead of conflicting forever.
    const remoteRevision = Number.isInteger(remoteResult?.meeting?.revision)
      ? remoteResult.meeting.revision
      : (remoteCheckpoint?.meetingId === checkpoint.meetingId ? remoteCheckpoint.revision : null)
    this.revision = Number.isInteger(remoteRevision) && remoteRevision < checkpoint.revision
      ? remoteRevision
      : checkpoint.revision
    this.last = checkpoint
    return clone(checkpoint)
  }

  async load(meetingId) {
    let checkpoint = null
    if (this.loadRemote) {
      const result = await this.loadRemote(meetingId)
      checkpoint = result?.checkpoint || result?.meeting?.checkpoint || null
    }
    if (!checkpoint) {
      const local = this._readLocal()
      if (local?.meetingId === meetingId) checkpoint = local
    }
    if (!checkpoint) return null
    checkpoint = hydrateMeetingCheckpoint(checkpoint)
    this.revision = checkpoint.revision
    this.last = checkpoint
    return clone(checkpoint)
  }

  async refreshRemote(meetingId) {
    if (!this.loadRemote) return null
    const result = await this.loadRemote(meetingId)
    const raw = result?.checkpoint || result?.meeting?.checkpoint || null
    if (!raw) return null
    const checkpoint = hydrateMeetingCheckpoint(raw)
    const remoteRevision = Number.isInteger(result?.meeting?.revision)
      ? result.meeting.revision
      : checkpoint.revision
    this.revision = remoteRevision
    this.last = checkpoint
    this.remoteLoadError = null
    this._writeLocal(checkpoint)
    return clone(checkpoint)
  }

  waitForWrites() {
    return this._writes
  }

  clearLocal() {
    try { this.storage?.removeItem(this.storageKey) } catch { /* storage unavailable */ }
  }

  _writeLocal(checkpoint) {
    try { this.storage?.setItem(this.storageKey, JSON.stringify(checkpoint)) } catch { /* server copy remains authoritative */ }
  }

  _readLocal() {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) || 'null')
      return value ? hydrateMeetingCheckpoint(value) : null
    } catch { return null }
  }
}
