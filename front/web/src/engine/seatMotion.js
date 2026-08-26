const DIRECTIONS = new Set(['down', 'left', 'right', 'up'])

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp01 = value => clamp(finite(value), 0, 1)

export const SEAT_PHASES = Object.freeze({
  STANDING: 'standing',
  ENTERING: 'entering',
  SEATED: 'seated',
  EXITING: 'exiting'
})

export const SEAT_ENTER_DURATION = 280
export const SEAT_EXIT_DURATION = 240
export const SEAT_APPROACH_RADIUS = 38
export const SEAT_RELEASE_RADIUS = 58

const SEAT_LAYOUTS = Object.freeze({
  down: Object.freeze({ offsetX: 0, scaleX: 1.055, scaleY: .82, rotation: 0, shearX: 0 }),
  up: Object.freeze({ offsetX: 0, scaleX: 1.045, scaleY: .805, rotation: 0, shearX: 0 }),
  left: Object.freeze({ offsetX: -2, scaleX: 1.07, scaleY: .79, rotation: -.018, shearX: .052 }),
  right: Object.freeze({ offsetX: 2, scaleX: 1.07, scaleY: .79, rotation: .018, shearX: -.052 })
})

const safeDirection = direction => DIRECTIONS.has(direction) ? direction : 'down'

const pointFrom = value => {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

const seatAnchor = seat => pointFrom(seat?.anchor) || pointFrom(seat)
const seatApproach = seat => pointFrom(seat?.approach) || seatAnchor(seat)

const seatId = seat => {
  if (seat?.id != null && String(seat.id)) return String(seat.id)
  const anchor = seatAnchor(seat)
  return anchor ? `seat:${anchor.x}:${anchor.y}` : null
}

const easeInOutCubic = value => {
  const progress = clamp01(value)
  return progress < .5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
}

export function createSeatMotionState({
  phase = SEAT_PHASES.STANDING,
  mix,
  seat = null,
  seatId: requestedSeatId = null,
  facing,
  anchor
} = {}) {
  const safePhase = Object.values(SEAT_PHASES).includes(phase) ? phase : SEAT_PHASES.STANDING
  const resolvedAnchor = pointFrom(anchor) || seatAnchor(seat)
  const resolvedSeatId = requestedSeatId == null ? seatId(seat) : String(requestedSeatId)
  const resolvedMix = mix == null
    ? (safePhase === SEAT_PHASES.SEATED || safePhase === SEAT_PHASES.EXITING ? 1 : 0)
    : clamp01(mix)
  if (safePhase === SEAT_PHASES.STANDING) {
    return {
      phase: SEAT_PHASES.STANDING,
      mix: 0,
      seatId: null,
      facing: safeDirection(facing || seat?.face || seat?.facing),
      anchor: null
    }
  }
  return {
    phase: safePhase,
    mix: safePhase === SEAT_PHASES.SEATED ? 1 : resolvedMix,
    seatId: resolvedSeatId,
    facing: safeDirection(facing || seat?.face || seat?.facing),
    anchor: resolvedAnchor
  }
}

// The wider release radius prevents a seated actor from rapidly toggling when
// their foot anchor lands on the edge of a chair's approach area. Both points
// use world-space pixels; map/tile conversion stays with the world engine.
export function seatApproachProximity(actor, seat, {
  enterRadius = SEAT_APPROACH_RADIUS,
  releaseRadius = SEAT_RELEASE_RADIUS
} = {}) {
  const actorPoint = pointFrom(actor)
  const targetPoint = seatApproach(seat)
  const safeEnterRadius = clamp(finite(enterRadius, SEAT_APPROACH_RADIUS), 1, 192)
  const safeReleaseRadius = clamp(
    finite(releaseRadius, SEAT_RELEASE_RADIUS),
    safeEnterRadius,
    240
  )
  const distance = actorPoint && targetPoint
    ? Math.hypot(actorPoint.x - targetPoint.x, actorPoint.y - targetPoint.y)
    : Infinity
  return {
    distance,
    withinEnter: distance <= safeEnterRadius,
    withinRelease: distance <= safeReleaseRadius,
    enterRadius: safeEnterRadius,
    releaseRadius: safeReleaseRadius
  }
}

const normalizedState = state => {
  const validPhase = Object.values(SEAT_PHASES).includes(state?.phase)
    ? state.phase
    : SEAT_PHASES.STANDING
  const mix = clamp01(state?.mix)
  const id = state?.seatId == null ? null : String(state.seatId)
  return {
    phase: mix === 0 && validPhase === SEAT_PHASES.SEATED ? SEAT_PHASES.STANDING : validPhase,
    mix,
    seatId: id,
    facing: safeDirection(state?.facing),
    anchor: pointFrom(state?.anchor)
  }
}

// Pure transition reducer for one actor. Passing the nearest chair is enough:
// proximity starts entry, release-radius hysteresis keeps the seat, and losing
// the chair starts a reversible exit. A new chair never teleports an actor out
// of the old one; it becomes eligible after the old exit reaches standing.
export function advanceSeatMotion(state, {
  actor = null,
  seat = null,
  near,
  enabled = true,
  deltaMs = 16.67,
  enterDurationMs = SEAT_ENTER_DURATION,
  exitDurationMs = SEAT_EXIT_DURATION,
  enterRadius = SEAT_APPROACH_RADIUS,
  releaseRadius = SEAT_RELEASE_RADIUS,
  immediate = false,
  reduceMotion = false
} = {}) {
  const previous = normalizedState(state)
  const candidateId = seatId(seat)
  const candidateAnchor = seatAnchor(seat)
  const candidateFacing = safeDirection(seat?.face || seat?.facing)
  const proximity = seatApproachProximity(actor, seat, { enterRadius, releaseRadius })
  const explicitNear = typeof near === 'boolean'
  const sameSeat = !!candidateId && candidateId === previous.seatId
  const withinRange = explicitNear
    ? near
    : (sameSeat ? proximity.withinRelease : proximity.withinEnter)
  const candidateWanted = !!enabled && !!candidateId && !!candidateAnchor && withinRange
  const occupied = !!previous.seatId && previous.mix > 0
  const changingSeat = occupied && candidateId !== previous.seatId
  const shouldSeat = candidateWanted && !changingSeat

  let activeSeatId = previous.seatId
  let facing = previous.facing
  let anchor = previous.anchor
  if (!occupied && candidateWanted) {
    activeSeatId = candidateId
    facing = candidateFacing
    anchor = candidateAnchor
  } else if (sameSeat && candidateWanted) {
    // Permit a map layout refresh without changing animation identity.
    facing = candidateFacing
    anchor = candidateAnchor
  }

  if (reduceMotion || immediate) {
    if (candidateWanted) {
      return {
        phase: SEAT_PHASES.SEATED,
        mix: 1,
        seatId: candidateId,
        facing: candidateFacing,
        anchor: candidateAnchor
      }
    }
    return {
      phase: SEAT_PHASES.STANDING,
      mix: 0,
      seatId: null,
      facing,
      anchor: null
    }
  }

  const dt = clamp(finite(deltaMs, 16.67), 0, 80)
  const enterDuration = clamp(finite(enterDurationMs, SEAT_ENTER_DURATION), 80, 2000)
  const exitDuration = clamp(finite(exitDurationMs, SEAT_EXIT_DURATION), 80, 2000)
  const mix = clamp01(previous.mix + (shouldSeat ? dt / enterDuration : -dt / exitDuration))

  if (mix >= 1) {
    return {
      phase: SEAT_PHASES.SEATED,
      mix: 1,
      seatId: activeSeatId,
      facing,
      anchor
    }
  }
  if (mix <= 0 && !shouldSeat) {
    return {
      phase: SEAT_PHASES.STANDING,
      mix: 0,
      seatId: null,
      facing,
      anchor: null
    }
  }
  return {
    phase: shouldSeat ? SEAT_PHASES.ENTERING : SEAT_PHASES.EXITING,
    mix,
    seatId: activeSeatId,
    facing,
    anchor
  }
}

// The transform is applied around the authored foot/ground anchor. offsetY and
// groundOffsetY intentionally remain zero throughout entry and exit: vertical
// compression lowers the hips while the feet and shadow never float above the
// chair's floor position.
export function seatPoseLayout(state, { facing } = {}) {
  const current = normalizedState(state)
  const direction = safeDirection(facing || current.facing)
  const layout = SEAT_LAYOUTS[direction]
  const mix = easeInOutCubic(current.mix)
  return {
    phase: current.phase,
    active: mix > 0,
    isSeated: mix >= .55,
    seated: current.phase === SEAT_PHASES.SEATED && mix === 1,
    facing: direction,
    mix,
    offsetX: layout.offsetX * mix,
    offsetY: 0,
    groundOffsetY: 0,
    rotation: layout.rotation * mix,
    shearX: layout.shearX * mix,
    scaleX: 1 + (layout.scaleX - 1) * mix,
    scaleY: 1 + (layout.scaleY - 1) * mix,
    shadowScaleX: 1 - .14 * mix,
    shadowScaleY: 1 - .24 * mix,
    shadowAlpha: 1 - .12 * mix
  }
}
