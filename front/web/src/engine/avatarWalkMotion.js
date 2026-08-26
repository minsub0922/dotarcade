const DIRECTIONS = new Set(['down', 'left', 'right', 'up'])

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

export const NEUTRAL_AVATAR_WALK_POSE = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  shearX: 0,
  scaleX: 1,
  scaleY: 1,
  shadowScaleX: 1,
  shadowScaleY: 1,
  shadowAlpha: 1,
  phase: 0,
  stride: 0,
  mix: 0
})

const neutralPose = () => ({ ...NEUTRAL_AVATAR_WALK_POSE })

export function createAvatarWalkMotionState() {
  return { mix: 0, pose: neutralPose() }
}

// Secondary walking motion is intentionally independent from pathfinding and
// the sprite atlas. It only returns a small foot-pivot transform, so collision,
// sorting and the authored 48x72 ground anchor remain unchanged. Like the
// existing frame sampler, it mutates only the state owned by one entity.
export function sampleAvatarWalkMotion(state, {
  distance = 0,
  direction = 'down',
  speed = 3,
  moving = false,
  paused = false,
  reset = false,
  reduceMotion = false,
  deltaMs = 16.67
} = {}) {
  const target = state && typeof state === 'object' ? state : createAvatarWalkMotionState()
  const safeDirection = DIRECTIONS.has(direction) ? direction : 'down'
  const dt = clamp(finite(deltaMs, 16.67), 0, 50)

  if (paused || reset || reduceMotion) {
    target.mix = 0
    target.pose = neutralPose()
    return target.pose
  }

  const desiredMix = moving ? 1 : 0
  const responseMs = moving ? 82 : 125
  const blend = dt > 0 ? 1 - Math.exp(-dt / responseMs) : 0
  target.mix += (desiredMix - finite(target.mix)) * blend
  if (target.mix < .001) target.mix = 0
  if (target.mix > .999) target.mix = 1

  if (target.mix === 0) {
    target.pose = neutralPose()
    return target.pose
  }

  // Keep the secondary motion on the same travelled-distance cadence used by
  // avatarAnimation.sampleWalkFrame: one quarter-cycle per atlas pose.
  const safeSpeed = Math.abs(finite(speed, 3))
  const phaseDistance = Math.max(18, safeSpeed * 7.2)
  const phase = Math.max(0, finite(distance)) / phaseDistance * (Math.PI / 2)
  const stride = Math.sin(phase)
  const contact = Math.abs(stride)
  const mix = target.mix
  const speedWeight = clamp(safeSpeed / 4.4, .62, 1)
  const horizontal = safeDirection === 'left' || safeDirection === 'right'
  const forward = safeDirection === 'left' ? -1 : safeDirection === 'right' ? 1 : 0

  // Values stay deliberately below a pixel/radian threshold that would make
  // the pixel art shimmer. Scaling happens around the foot anchor: the head
  // settles at contact while the feet never float above the world position.
  const sway = stride * mix * speedWeight
  const compression = contact * mix * speedWeight
  target.pose = {
    x: 0,
    y: 0,
    rotation: horizontal
      ? forward * (.012 + stride * .004) * mix * speedWeight
      : stride * .009 * mix * speedWeight,
    shearX: -sway * (horizontal ? .004 : .009),
    scaleX: 1 + compression * .006,
    scaleY: 1 - compression * .009,
    shadowScaleX: 1 - compression * .075,
    shadowScaleY: 1 - compression * .11,
    shadowAlpha: 1 - compression * .08,
    phase,
    stride,
    mix
  }
  return target.pose
}
