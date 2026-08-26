import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEAT_PHASES,
  advanceSeatMotion,
  createSeatMotionState,
  seatApproachProximity,
  seatPoseLayout
} from './seatMotion.js'

const chair = {
  id: 'desk-pm',
  x: 240,
  y: 320,
  approach: { x: 240, y: 344 },
  face: 'up'
}

const advance = (state, options, frames = 12) => {
  let next = state
  for (let frame = 0; frame < frames; frame++) next = advanceSeatMotion(next, options)
  return next
}

test('chair approach uses bounded enter/release radii with deterministic hysteresis', () => {
  const approaching = seatApproachProximity({ x: 240, y: 310 }, chair, {
    enterRadius: 35,
    releaseRadius: 50
  })
  assert.equal(approaching.distance, 34)
  assert.equal(approaching.withinEnter, true)
  assert.equal(approaching.withinRelease, true)

  const edge = seatApproachProximity({ x: 240, y: 388 }, chair, {
    enterRadius: 35,
    releaseRadius: 50
  })
  assert.equal(edge.distance, 44)
  assert.equal(edge.withinEnter, false)
  assert.equal(edge.withinRelease, true)

  const invalid = seatApproachProximity({ x: NaN, y: 0 }, chair, {
    enterRadius: -100,
    releaseRadius: 9999
  })
  assert.equal(invalid.distance, Infinity)
  assert.equal(invalid.withinEnter, false)
  assert.equal(invalid.enterRadius, 1)
  assert.equal(invalid.releaseRadius, 240)
})

test('entry and exit are pure, eased, bounded and deterministic', () => {
  const initial = createSeatMotionState()
  const snapshot = structuredClone(initial)
  const options = { actor: chair.approach, seat: chair, deltaMs: 40 }
  const first = advanceSeatMotion(initial, options)
  const firstAgain = advanceSeatMotion(initial, options)

  assert.deepEqual(initial, snapshot, 'the reducer must not mutate caller-owned state')
  assert.deepEqual(first, firstAgain, 'the same state and inputs must return the same transition')
  assert.equal(first.phase, SEAT_PHASES.ENTERING)
  assert.ok(first.mix > 0 && first.mix < 1)
  assert.equal(first.seatId, chair.id)
  assert.equal(first.facing, 'up')
  assert.deepEqual(first.anchor, { x: chair.x, y: chair.y })

  const seated = advance(first, options, 12)
  assert.equal(seated.phase, SEAT_PHASES.SEATED)
  assert.equal(seated.mix, 1)

  const leaving = advanceSeatMotion(seated, { seat: null, deltaMs: 40 })
  assert.equal(leaving.phase, SEAT_PHASES.EXITING)
  assert.ok(leaving.mix > 0 && leaving.mix < 1)
  const standing = advance(leaving, { seat: null, deltaMs: 80 }, 12)
  assert.deepEqual(standing, {
    phase: SEAT_PHASES.STANDING,
    mix: 0,
    seatId: null,
    facing: 'up',
    anchor: null
  })
})

test('scripted seating can create or resolve a serializable final state immediately', () => {
  const scripted = createSeatMotionState({
    phase: SEAT_PHASES.SEATED,
    seat: chair
  })
  assert.deepEqual(scripted, {
    phase: SEAT_PHASES.SEATED,
    mix: 1,
    seatId: chair.id,
    facing: 'up',
    anchor: { x: chair.x, y: chair.y }
  })
  assert.doesNotThrow(() => JSON.stringify(scripted))

  const immediateExit = advanceSeatMotion(scripted, {
    enabled: false,
    immediate: true
  })
  assert.equal(immediateExit.phase, SEAT_PHASES.STANDING)
  assert.equal(immediateExit.mix, 0)
})

test('leaving reverses smoothly when the same chair becomes near again', () => {
  const seated = advance(createSeatMotionState(), {
    actor: chair.approach,
    seat: chair,
    deltaMs: 80
  }, 5)
  const leaving = advanceSeatMotion(seated, { seat: chair, near: false, deltaMs: 40 })
  const returning = advanceSeatMotion(leaving, { seat: chair, near: true, deltaMs: 40 })

  assert.equal(leaving.phase, SEAT_PHASES.EXITING)
  assert.equal(returning.phase, SEAT_PHASES.ENTERING)
  assert.ok(returning.mix > leaving.mix)
  assert.equal(returning.seatId, chair.id)
})

test('changing chairs exits the old seat before adopting the new one', () => {
  const other = { id: 'desk-dev', x: 500, y: 300, face: 'left' }
  const seated = advance(createSeatMotionState(), {
    actor: chair.approach,
    seat: chair,
    deltaMs: 80
  }, 5)
  const switching = advanceSeatMotion(seated, {
    actor: other,
    seat: other,
    near: true,
    deltaMs: 80
  })
  assert.equal(switching.phase, SEAT_PHASES.EXITING)
  assert.equal(switching.seatId, chair.id)

  const standing = advance(switching, { actor: other, seat: other, near: true, deltaMs: 80 }, 3)
  assert.equal(standing.phase, SEAT_PHASES.STANDING)
  const enteringOther = advanceSeatMotion(standing, {
    actor: other,
    seat: other,
    near: true,
    deltaMs: 40
  })
  assert.equal(enteringOther.phase, SEAT_PHASES.ENTERING)
  assert.equal(enteringOther.seatId, other.id)
  assert.equal(enteringOther.facing, 'left')
})

test('seated layouts mirror side views while preserving the floor anchor', () => {
  const seated = {
    phase: SEAT_PHASES.SEATED,
    mix: 1,
    seatId: 'chair',
    facing: 'right',
    anchor: { x: 0, y: 0 }
  }
  const right = seatPoseLayout(seated)
  const left = seatPoseLayout(seated, { facing: 'left' })

  assert.equal(right.offsetX, -left.offsetX)
  assert.equal(right.rotation, -left.rotation)
  assert.equal(right.shearX, -left.shearX)
  assert.equal(right.scaleX, left.scaleX)
  assert.equal(right.scaleY, left.scaleY)
  assert.equal(right.offsetY, 0)
  assert.equal(left.offsetY, 0)
  assert.equal(right.groundOffsetY, 0)
  assert.equal(left.groundOffsetY, 0)
  assert.ok(right.scaleY < 1 && right.scaleY >= .79)

  for (const facing of ['down', 'left', 'right', 'up']) {
    for (const mix of [0, .1, .25, .5, .75, .9, 1]) {
      const pose = seatPoseLayout({ ...seated, mix, facing })
      assert.equal(pose.offsetY, 0)
      assert.equal(pose.groundOffsetY, 0)
      assert.ok(Math.abs(pose.offsetX) <= 2)
      assert.ok(Math.abs(pose.rotation) <= .018)
      assert.ok(Math.abs(pose.shearX) <= .052)
      assert.ok(pose.scaleX >= 1 && pose.scaleX <= 1.07)
      assert.ok(pose.scaleY >= .79 && pose.scaleY <= 1)
      assert.ok(pose.shadowScaleX >= .86 && pose.shadowScaleX <= 1)
      assert.ok(pose.shadowScaleY >= .76 && pose.shadowScaleY <= 1)
      assert.ok(pose.shadowAlpha >= .88 && pose.shadowAlpha <= 1)
      assert.equal(pose.isSeated, mix >= .55)
    }
  }
})

test('reduced motion resolves proximity changes immediately without residual lift', () => {
  const seated = advanceSeatMotion(createSeatMotionState(), {
    actor: chair.approach,
    seat: chair,
    reduceMotion: true
  })
  assert.deepEqual(seated, {
    phase: SEAT_PHASES.SEATED,
    mix: 1,
    seatId: chair.id,
    facing: 'up',
    anchor: { x: chair.x, y: chair.y }
  })
  assert.equal(seatPoseLayout(seated).groundOffsetY, 0)

  const standing = advanceSeatMotion(seated, {
    seat: null,
    reduceMotion: true
  })
  assert.equal(standing.phase, SEAT_PHASES.STANDING)
  assert.equal(standing.mix, 0)
  assert.equal(seatPoseLayout(standing).active, false)
})

test('pathological timing input cannot overshoot a transition', () => {
  const initial = createSeatMotionState()
  const hugeStep = advanceSeatMotion(initial, {
    actor: chair.approach,
    seat: chair,
    deltaMs: Infinity,
    enterDurationMs: -20
  })
  assert.equal(hugeStep.phase, SEAT_PHASES.ENTERING)
  assert.ok(hugeStep.mix >= 0 && hugeStep.mix <= 1)

  const malformed = seatPoseLayout({ phase: 'unknown', mix: 900, facing: 'diagonal' })
  assert.equal(malformed.facing, 'down')
  assert.equal(malformed.mix, 1)
  assert.equal(malformed.offsetY, 0)
})
