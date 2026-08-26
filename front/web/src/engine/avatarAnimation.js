const ROW_BY_DIRECTION = Object.freeze({ down: 0, left: 1, right: 2, up: 3 })
const COLUMN_BY_FRAME = Object.freeze({ idle: 0, stepL: 1, stepR: 2 })

export const AVATAR_FRAME = Object.freeze({ width: 48, height: 72 })
export const WALK_SEQUENCE = Object.freeze(['idle', 'stepL', 'idle', 'stepR'])
export const MOUNT_DURATION = 360
export const DISMOUNT_DURATION = 420

export function directionFromDelta(dx, dy, fallback = 'down', epsilon = 0.02) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < epsilon) return fallback
  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up')
}

export function createWalkState(x = 0, y = 0) {
  return { x, y, distance: 0, frame: 'idle' }
}

// Drive the gait from travelled distance rather than wall-clock time. Feet stop
// immediately when an NPC is blocked and faster actors do not appear to slide.
export function sampleWalkFrame(state, {
  x,
  y,
  speed = 3,
  moving = false,
  paused = false,
  teleportThreshold = 96
}) {
  if (!state || !Number.isFinite(state.x) || !Number.isFinite(state.y)) state = createWalkState(x, y)
  const dx = Number.isFinite(x) ? x - state.x : 0
  const dy = Number.isFinite(y) ? y - state.y : 0
  const travelled = Math.hypot(dx, dy)

  if (moving && !paused && travelled > 0.01 && travelled < teleportThreshold) state.distance += travelled
  state.x = Number.isFinite(x) ? x : state.x
  state.y = Number.isFinite(y) ? y : state.y

  if (!moving || paused) {
    state.frame = 'idle'
    return state.frame
  }

  // Roughly eight visual poses per second at the engine's normal movement
  // speeds, while keeping a complete left/right stride tied to world distance.
  const phaseDistance = Math.max(18, Math.abs(speed) * 7.2)
  const phase = Math.floor(state.distance / phaseDistance) % WALK_SEQUENCE.length
  state.frame = WALK_SEQUENCE[phase]
  return state.frame
}

export function sheetSource(direction = 'down', frame = 'idle') {
  const row = ROW_BY_DIRECTION[direction] ?? ROW_BY_DIRECTION.down
  const column = COLUMN_BY_FRAME[frame] ?? COLUMN_BY_FRAME.idle
  return {
    x: column * AVATAR_FRAME.width,
    y: row * AVATAR_FRAME.height,
    width: AVATAR_FRAME.width,
    height: AVATAR_FRAME.height
  }
}

const clamp01 = value => Math.max(0, Math.min(1, value))
const easeOutCubic = value => 1 - Math.pow(1 - clamp01(value), 3)

// Mount/dismount transitions stay code-driven so every avatar keeps the exact
// same sprite identity and foot anchor. The returned transform is applied
// around the character's ground anchor by the canvas renderer.
export function rideTransitionPose(motion, now, reduceMotion = false) {
  if (!motion?.phase || !Number.isFinite(motion.startedAt)) {
    return { active: false, liftMix: 0, hop: 0, offsetX: 0, rotation: 0, scaleX: 1, scaleY: 1 }
  }
  const side = motion.dir === 'left' ? -1 : motion.dir === 'right' ? 1 : 0
  if (motion.phase === 'mount') {
    const progress = reduceMotion ? 1 : clamp01((now - motion.startedAt) / MOUNT_DURATION)
    const arc = Math.sin(progress * Math.PI)
    return {
      active: progress < 1,
      progress,
      liftMix: easeOutCubic(progress),
      hop: reduceMotion ? 0 : -arc * 5.5,
      offsetX: side * (1 - progress) * -5,
      rotation: reduceMotion ? 0 : side * arc * 0.025,
      scaleX: reduceMotion ? 1 : 1 + arc * 0.055,
      scaleY: reduceMotion ? 1 : 1 - arc * 0.075
    }
  }
  if (motion.phase === 'dismount') {
    const progress = reduceMotion ? 1 : clamp01((now - motion.startedAt) / DISMOUNT_DURATION)
    const arc = Math.sin(progress * Math.PI)
    return {
      active: progress < 1,
      progress,
      liftMix: 1 - easeOutCubic(progress),
      hop: reduceMotion ? 0 : -arc * 8,
      offsetX: side * progress * 9,
      rotation: reduceMotion ? 0 : side * arc * 0.04,
      scaleX: reduceMotion ? 1 : 1 - arc * 0.045,
      scaleY: reduceMotion ? 1 : 1 + arc * 0.06
    }
  }
  return { active: false, liftMix: 1, hop: 0, offsetX: 0, rotation: 0, scaleX: 1, scaleY: 1 }
}
