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

// Fast vehicles spend much more time on diagonal input than walking avatars.
// A small directional hysteresis keeps the four-way sprite from flickering
// between horizontal and vertical poses while the rider steers through a turn.
export function rideDirectionFromDelta(dx, dy, fallback = 'down', bias = 1.22, epsilon = 0.02) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < epsilon) return fallback
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  const wasHorizontal = fallback === 'left' || fallback === 'right'
  if (wasHorizontal && ay <= ax * bias) return dx < 0 ? 'left' : dx > 0 ? 'right' : fallback
  if (!wasHorizontal && ax <= ay * bias) return dy < 0 ? 'up' : dy > 0 ? 'down' : fallback
  return ax > ay
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

const RIDE_FORWARD = Object.freeze({
  down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }
})

// Geometry for a mounted avatar is kept separate from drawing. In particular,
// bicycle riders have a real hip/seat anchor and only render the sprite through
// the waist; articulated legs are added by the world renderer at the pedals.
export function rideLayout(kind = 'bicycle', direction = 'right') {
  const dir = RIDE_FORWARD[direction] ? direction : 'right'
  const forward = RIDE_FORWARD[dir]
  const horizontal = forward.x !== 0
  const side = horizontal ? forward.x : 0
  const bicycle = kind === 'bicycle'

  if (horizontal) {
    const vehicleScale = bicycle ? 1.62 : 1.58
    return {
      kind: bicycle ? 'bicycle' : 'scooter',
      direction: dir,
      forward,
      horizontal,
      seated: bicycle,
      vehicleScale,
      cropRatio: bicycle ? 0.735 : 1,
      bodyBottom: { x: side * (bicycle ? -6.5 : -1.5), y: bicycle ? -29.5 : -4 },
      hip: { x: side * (bicycle ? -6.5 : -2), y: bicycle ? -31.5 : -21 },
      shoulder: { x: side * (bicycle ? 1.5 : 1), y: bicycle ? -55 : -42 },
      handles: bicycle
        ? [{ x: side * 31, y: -40 }, { x: side * 27.5, y: -36.5 }]
        : [{ x: side * 31, y: -48 }, { x: side * 27, y: -44 }],
      lean: side * (bicycle ? 0.064 : 0.038)
    }
  }

  // Front/back poses share a centred saddle, but the handle remains visibly
  // ahead of the hips in the direction of travel. This makes direction changes
  // legible instead of showing a horizontally squashed bicycle.
  const ahead = forward.y
  const vehicleScale = bicycle ? 1.62 : 1.58
  return {
    kind: bicycle ? 'bicycle' : 'scooter',
    direction: dir,
    forward,
    horizontal,
    seated: bicycle,
    vehicleScale,
    // Front/back sprites contain far more of the original straight legs than
    // the profile view.  Cut at the waist so the articulated knees/pedals stay
    // visible and the rider reads as seated instead of standing on the frame.
    cropRatio: bicycle ? 0.62 : 1,
    bodyBottom: { x: 0, y: bicycle ? -28.5 - ahead * 2.5 : -4 },
    hip: { x: 0, y: bicycle ? -30 - ahead * 2.5 : -21 },
    shoulder: { x: 0, y: bicycle ? -54 : -41 },
    handles: bicycle
      ? [{ x: -9.5, y: -38 + ahead * 7 }, { x: 9.5, y: -38 + ahead * 7 }]
      : [{ x: -10.5, y: -47 + ahead * 8 }, { x: 10.5, y: -47 + ahead * 8 }],
    lean: 0
  }
}

export function sampleRideCycle(distance = 0, moving = false, kind = 'bicycle', reduceMotion = false) {
  const travelled = Number.isFinite(distance) ? Math.max(0, distance) : 0
  const bicycle = kind === 'bicycle'
  const pedalPhase = reduceMotion ? Math.PI / 4 : travelled / (bicycle ? 38 : 44)
  // Vehicle art is rendered at 1.62x/1.58x, so use the scaled wheel radius.
  // Tying radians to travelled distance prevents the enlarged wheel from
  // visibly spinning faster than the bicycle advances.
  const wheelPhase = reduceMotion ? 0 : travelled / (bicycle ? 14.6 : 9.5)
  const kick = reduceMotion || !moving ? 0 : (1 - Math.cos(pedalPhase * 2)) / 2
  return {
    pedalPhase,
    wheelPhase,
    kick,
    // Travel-driven suspension stops on exactly the same frame as the vehicle.
    bob: reduceMotion || !moving ? 0 : Math.sin(pedalPhase * 2) * (bicycle ? 0.65 : 0.38)
  }
}

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
