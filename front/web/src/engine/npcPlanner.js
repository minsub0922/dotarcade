// DOTCADE — bounded utility/goal planner for autonomous NPCs.
//
// The module stays DOM/canvas agnostic so the decision policy can be tested and
// reused by the arcade simulation. world.js owns observations and action side
// effects; this file owns goal scoring, bounded plans and loop guards.

export const NPC_GOALS = Object.freeze({
  IDLE: 'idle',
  WANDER: 'wander',
  RETURN_HOME: 'returnHome',
  WORK: 'work',
  SOCIALIZE: 'socialize',
  PORTABLE_PLAY: 'portablePlay',
  ARCADE_PLAY: 'arcadePlay'
})

export const AUTONOMY_LIMITS = Object.freeze({
  maxPlanLength: 4,
  maxGoalMs: 18000,
  maxActionMs: 11000,
  maxReplansPerWindow: 5,
  replanWindowMs: 12000,
  stuckSampleMs: 850,
  stuckTimeoutMs: 2800,
  goalCooldownMs: 3600,
  targetCooldownMs: 7200,
  failureBackoffMs: 1400,
  recentGoalWindow: 5
})

export const DEFAULT_GOAL_WEIGHTS = Object.freeze({
  [NPC_GOALS.IDLE]: 0.16,
  [NPC_GOALS.WANDER]: 0.58,
  [NPC_GOALS.RETURN_HOME]: 0.72,
  [NPC_GOALS.WORK]: 0.62,
  [NPC_GOALS.SOCIALIZE]: 0.56,
  [NPC_GOALS.PORTABLE_PLAY]: 0.55,
  [NPC_GOALS.ARCADE_PLAY]: 0.72
})

// IDs, role slugs and evaluation strategies can all be used as profile keys.
// Callers may also pass a final per-agent `weights` patch.
export const PROFILE_GOAL_WEIGHTS = Object.freeze({
  team: { wander: 0.34, returnHome: 0.9, work: 0.92, socialize: 0.62, portablePlay: 0.5, arcadePlay: 0.34 },
  visitor: { wander: 0.72, returnHome: 0.08, work: 0.02, socialize: 0.64, portablePlay: 0.68, arcadePlay: 0.9 },
  pm: { work: 1.18, returnHome: 1.02, socialize: 0.62, portablePlay: 0.3 },
  dev1: { work: 1.05, portablePlay: 0.72, arcadePlay: 0.66, socialize: 0.42 },
  dev2: { work: 0.88, portablePlay: 0.94, arcadePlay: 0.85, socialize: 0.72 },
  designer: { work: 0.92, wander: 0.55, portablePlay: 0.69, socialize: 0.7 },
  writer: { work: 0.82, wander: 0.56, socialize: 0.91, portablePlay: 0.6 },
  explorer: { wander: 1.04, arcadePlay: 1.02, portablePlay: 0.79, socialize: 0.72 },
  scoreHunter: { arcadePlay: 1.24, portablePlay: 0.87, wander: 0.46 },
  survivor: { arcadePlay: 0.68, portablePlay: 0.92, socialize: 0.57, wander: 0.48 },
  bugBreaker: { arcadePlay: 1.18, portablePlay: 0.78, wander: 0.71 },
  learner: { arcadePlay: 0.98, portablePlay: 0.9, socialize: 0.66, wander: 0.62 }
})

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const tileKey = tile => Array.isArray(tile) ? `${tile[0]},${tile[1]}` : ''

export function goalWeightsFor(profiles = [], overrides = {}) {
  const merged = { ...DEFAULT_GOAL_WEIGHTS }
  const keys = Array.isArray(profiles) ? profiles : [profiles]
  for (const key of keys.filter(Boolean)) Object.assign(merged, PROFILE_GOAL_WEIGHTS[key] || {})
  return Object.assign(merged, overrides || {})
}

export function createAutonomyState({
  enabled = true,
  profiles = [],
  weights = {},
  now = 0,
  speedScale = 1,
  arrivalRadius = 5
} = {}) {
  return {
    enabled,
    profiles: Array.isArray(profiles) ? [...profiles] : [profiles].filter(Boolean),
    weightOverrides: { ...weights },
    weights: goalWeightsFor(profiles, weights),
    limits: { ...AUTONOMY_LIMITS },
    phase: 'observe',
    currentGoal: null,
    plan: [],
    actionIndex: 0,
    actionStartedAt: 0,
    goalStartedAt: 0,
    nextThinkAt: now + 300,
    cooldowns: new Map(),
    targetCooldowns: new Map(),
    recentGoals: [],
    replanTimes: [],
    replanCount: 0,
    blockedUntil: 0,
    externalCommand: false,
    assignment: null,
    activity: null,
    conversation: null,
    speedScale: clamp(speedScale, 0.88, 1.14),
    arrivalRadius: clamp(arrivalRadius, 3, 9),
    steering: { x: 0, y: 0 },
    stuck: { x: null, y: null, sampledAt: now, since: 0, routeLength: 0 },
    drives: { move: 0.25, social: 0.2, play: 0.22, work: 0.2, rest: 0.1 },
    feedback: [],
    evidence: [],
    sentenceCooldowns: new Map()
  }
}

export function configureAutonomyState(state, patch = {}) {
  if (!state) return state
  if (typeof patch.enabled === 'boolean') state.enabled = patch.enabled
  if (patch.profiles) state.profiles = Array.isArray(patch.profiles) ? [...patch.profiles] : [patch.profiles]
  if (patch.weights) state.weightOverrides = { ...state.weightOverrides, ...patch.weights }
  if (patch.weights || patch.profiles) state.weights = goalWeightsFor(state.profiles, state.weightOverrides)
  if (patch.limits) state.limits = { ...state.limits, ...patch.limits, maxPlanLength: Math.min(6, patch.limits.maxPlanLength || state.limits.maxPlanLength) }
  if (patch.speedScale != null) state.speedScale = clamp(patch.speedScale, 0.88, 1.14)
  if (patch.arrivalRadius != null) state.arrivalRadius = clamp(patch.arrivalRadius, 3, 9)
  return state
}

export function ageDrives(state, dt, observation = {}) {
  if (!state) return
  const seconds = Math.min(2, Math.max(0, dt / 1000))
  state.drives.move = clamp(state.drives.move + seconds * 0.012, 0, 1)
  state.drives.social = clamp(state.drives.social + seconds * (observation.nearbyCount ? 0.018 : 0.006), 0, 1)
  state.drives.play = clamp(state.drives.play + seconds * 0.013, 0, 1)
  state.drives.work = clamp(state.drives.work + seconds * (observation.map === 'office' ? 0.01 : 0.002), 0, 1)
  state.drives.rest = clamp(state.drives.rest + seconds * 0.006, 0, 1)
}

const driveFor = (state, kind) => {
  if (kind === NPC_GOALS.WANDER) return state.drives.move
  if (kind === NPC_GOALS.SOCIALIZE) return state.drives.social
  if (kind === NPC_GOALS.PORTABLE_PLAY || kind === NPC_GOALS.ARCADE_PLAY) return state.drives.play
  if (kind === NPC_GOALS.WORK || kind === NPC_GOALS.RETURN_HOME) return state.drives.work
  return state.drives.rest
}

export function chooseUtilityGoal(state, candidates, now, rng = Math.random) {
  if (!state || !candidates?.length) return null
  const assigned = candidates.find(c => c.assigned)
  if (assigned) return { ...assigned, utility: Number.POSITIVE_INFINITY }

  let best = null
  for (const candidate of candidates) {
    if (!candidate?.kind) continue
    if ((state.cooldowns.get(candidate.kind) || 0) > now) continue
    const targetKey = candidate.targetId || tileKey(candidate.targetTile)
    if (targetKey && (state.targetCooldowns.get(targetKey) || 0) > now) continue
    const repeats = state.recentGoals.filter(x => x.kind === candidate.kind).length
    const sameTarget = targetKey && state.recentGoals.filter(x => x.targetKey === targetKey).length
    const repeatPenalty = repeats * 0.17 + sameTarget * 0.25
    const utility = (state.weights[candidate.kind] ?? 0.25)
      + driveFor(state, candidate.kind) * 0.48
      + (candidate.opportunity || 0)
      + (rng() - 0.5) * 0.16
      - repeatPenalty
    if (!best || utility > best.utility) best = { ...candidate, utility }
  }
  return best
}

export function buildBoundedPlan(goal, limits = AUTONOMY_LIMITS) {
  if (!goal) return []
  const plan = []
  if (goal.targetTile) plan.push({ kind: 'move', targetTile: [...goal.targetTile], targetId: goal.targetId || null })
  if (goal.kind === NPC_GOALS.RETURN_HOME) plan.push({ kind: 'sit', face: goal.face || 'up' })
  else if (goal.kind === NPC_GOALS.SOCIALIZE) plan.push({ kind: 'socialize', targetId: goal.targetId, maxTurns: clamp(goal.maxTurns || 3, 2, 3) })
  else if (goal.kind === NPC_GOALS.WORK) {
    if (goal.targetTile) plan.push({ kind: 'sit', face: goal.face || 'up' })
    plan.push({ kind: 'activity', activity: 'work', durationMs: clamp(goal.durationMs || 4600, 1000, limits.maxActionMs), data: goal.data || {} })
  }
  else if (goal.kind === NPC_GOALS.PORTABLE_PLAY) plan.push({ kind: 'activity', activity: 'portablePlay', durationMs: clamp(goal.durationMs || 6200, 1200, limits.maxActionMs), data: goal.data || {} })
  else if (goal.kind === NPC_GOALS.ARCADE_PLAY) plan.push({ kind: 'activity', activity: 'arcadePlay', durationMs: clamp(goal.durationMs || 5200, 1000, limits.maxActionMs), data: goal.data || {} })
  else if (goal.kind === NPC_GOALS.IDLE) plan.push({ kind: 'wait', durationMs: clamp(goal.durationMs || 1400, 500, 3600) })
  if (!plan.length) plan.push({ kind: 'wait', durationMs: 700 })
  return plan.slice(0, Math.max(1, Math.min(6, limits.maxPlanLength || AUTONOMY_LIMITS.maxPlanLength)))
}

export function consumeReplanBudget(state, now) {
  const windowMs = state.limits.replanWindowMs
  state.replanTimes = state.replanTimes.filter(t => now - t < windowMs)
  if (state.replanTimes.length >= state.limits.maxReplansPerWindow) {
    state.blockedUntil = Math.max(state.blockedUntil, now + state.limits.failureBackoffMs * 2)
    return false
  }
  state.replanTimes.push(now)
  state.replanCount += 1
  return true
}

export function beginGoal(state, goal, plan, now) {
  state.currentGoal = goal
  state.plan = plan.slice(0, state.limits.maxPlanLength)
  state.actionIndex = 0
  state.actionStartedAt = now
  state.goalStartedAt = now
  state.phase = 'act'
  state.stuck = { x: null, y: null, sampledAt: now, since: 0, routeLength: 0 }
  state.evidence.push({ type: 'goal-selected', goal: goal.kind, target: goal.targetId || tileKey(goal.targetTile), at: now, utility: goal.utility })
  state.evidence = state.evidence.slice(-24)
}

export function advanceAction(state, now, evidence = null) {
  if (evidence) {
    state.evidence.push({ ...evidence, at: now })
    state.evidence = state.evidence.slice(-24)
  }
  state.actionIndex += 1
  state.actionStartedAt = now
  return state.actionIndex >= state.plan.length
}

export function actionTimedOut(state, now) {
  return !!state.currentGoal && (
    now - state.actionStartedAt > state.limits.maxActionMs
    || now - state.goalStartedAt > state.limits.maxGoalMs
  )
}

export function sampleStuck(state, entity, routeLength, now) {
  const stuck = state.stuck
  if (stuck.x == null || routeLength !== stuck.routeLength) {
    Object.assign(stuck, { x: entity.x, y: entity.y, sampledAt: now, since: 0, routeLength })
    return false
  }
  if (now - stuck.sampledAt < state.limits.stuckSampleMs) return false
  const moved = Math.hypot(entity.x - stuck.x, entity.y - stuck.y)
  if (routeLength > 0 && moved < 2.5) stuck.since = stuck.since || stuck.sampledAt
  else stuck.since = 0
  Object.assign(stuck, { x: entity.x, y: entity.y, sampledAt: now, routeLength })
  return !!stuck.since && now - stuck.since >= state.limits.stuckTimeoutMs
}

export function finishGoal(state, now, { status = 'success', reason = '', goal = state.currentGoal } = {}) {
  if (!goal) return null
  const targetKey = goal.targetId || tileKey(goal.targetTile)
  const failed = status !== 'success'
  state.cooldowns.set(goal.kind, now + (goal.cooldownMs || state.limits.goalCooldownMs) * (failed ? 1.25 : 1))
  if (targetKey) state.targetCooldowns.set(targetKey, now + (goal.targetCooldownMs || state.limits.targetCooldownMs) * (failed ? 1.35 : 1))
  state.recentGoals.push({ kind: goal.kind, targetKey, status, at: now })
  state.recentGoals = state.recentGoals.slice(-state.limits.recentGoalWindow)
  const drive = goal.kind === NPC_GOALS.SOCIALIZE ? 'social'
    : goal.kind === NPC_GOALS.WANDER ? 'move'
      : [NPC_GOALS.PORTABLE_PLAY, NPC_GOALS.ARCADE_PLAY].includes(goal.kind) ? 'play'
        : [NPC_GOALS.WORK, NPC_GOALS.RETURN_HOME].includes(goal.kind) ? 'work' : 'rest'
  state.drives[drive] = failed ? clamp(state.drives[drive] + 0.06, 0, 1) : clamp(state.drives[drive] * 0.24, 0, 1)
  const feedback = { goal: goal.kind, status, reason, at: now, elapsedMs: now - state.goalStartedAt, replans: state.replanCount }
  state.feedback.push(feedback)
  state.feedback = state.feedback.slice(-12)
  state.evidence.push({ type: 'goal-feedback', ...feedback })
  state.evidence = state.evidence.slice(-24)
  state.currentGoal = null
  state.plan = []
  state.actionIndex = 0
  state.actionStartedAt = 0
  state.goalStartedAt = 0
  state.activity = null
  state.conversation = null
  state.phase = 'feedback'
  state.nextThinkAt = now + (failed ? state.limits.failureBackoffMs : 700 + Math.random() * 1200)
  return feedback
}

function isWalkable(grid, x, y) {
  return x >= 0 && y >= 0 && y < grid.length && x < grid[0].length && grid[y][x] !== '#'
}

export function hasTileLineOfSight(grid, from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1]
  const distance = Math.hypot(dx, dy)
  const samples = Math.max(1, Math.ceil(distance * 5))
  let px = from[0], py = from[1]
  for (let i = 1; i <= samples; i++) {
    const x = Math.round(from[0] + dx * (i / samples))
    const y = Math.round(from[1] + dy * (i / samples))
    if (!isWalkable(grid, x, y)) return false
    if (x !== px && y !== py && (!isWalkable(grid, px, y) || !isWalkable(grid, x, py))) return false
    px = x; py = y
  }
  return true
}

// Greedily shortcut Manhattan A* nodes into a few collision-safe diagonal
// segments. Segment length is capped so local steering never cuts across a room.
export function smoothTilePath(grid, start, path, maxSegmentTiles = 6) {
  if (!path?.length) return []
  const result = []
  let anchor = start
  let index = 0
  while (index < path.length) {
    let next = index
    const scanEnd = Math.min(path.length - 1, index + 11)
    for (let i = scanEnd; i >= index; i--) {
      if (Math.hypot(path[i][0] - anchor[0], path[i][1] - anchor[1]) > maxSegmentTiles) continue
      if (hasTileLineOfSight(grid, anchor, path[i])) { next = i; break }
    }
    const waypoint = path[next]
    result.push([...waypoint])
    anchor = waypoint
    index = next + 1
  }
  return result
}

export function autonomySnapshot(state) {
  if (!state) return null
  return {
    enabled: state.enabled,
    phase: state.phase,
    goal: state.currentGoal?.kind || null,
    target: state.currentGoal?.targetId || state.currentGoal?.targetTile || null,
    plan: state.plan.map((step, i) => ({ kind: step.kind, status: i < state.actionIndex ? 'done' : i === state.actionIndex ? 'active' : 'queued' })),
    replans: state.replanCount,
    blockedUntil: state.blockedUntil,
    activity: state.activity?.kind || null,
    feedback: state.feedback.slice(-3),
    evidence: state.evidence.slice(-8)
  }
}
