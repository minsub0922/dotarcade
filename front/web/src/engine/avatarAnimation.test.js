import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WALK_SEQUENCE,
  DISMOUNT_DURATION,
  MOUNT_DURATION,
  createWalkState,
  directionFromDelta,
  rideTransitionPose,
  sampleWalkFrame,
  sheetSource
} from './avatarAnimation.js'

test('movement deltas map to the direction the avatar actually travels', () => {
  assert.equal(directionFromDelta(8, 0), 'right')
  assert.equal(directionFromDelta(-8, 0), 'left')
  assert.equal(directionFromDelta(0, 8), 'down')
  assert.equal(directionFromDelta(0, -8), 'up')
  assert.equal(directionFromDelta(0, 0, 'left'), 'left')
})

test('walking advances idle/contact poses from travelled distance', () => {
  const state = createWalkState(0, 0)
  const frames = []
  for (let i = 0; i < 4; i++) {
    frames.push(sampleWalkFrame(state, { x: i * 22, y: 0, speed: 3, moving: true }))
  }
  assert.deepEqual(frames, WALK_SEQUENCE)
  assert.equal(sampleWalkFrame(state, { x: 66, y: 0, speed: 3, moving: false }), 'idle')
})

test('teleports and paused actors never fast-forward the gait', () => {
  const state = createWalkState(0, 0)
  assert.equal(sampleWalkFrame(state, { x: 500, y: 500, moving: true }), 'idle')
  assert.equal(state.distance, 0)
  assert.equal(sampleWalkFrame(state, { x: 510, y: 500, moving: true, paused: true }), 'idle')
  assert.equal(state.distance, 0)
})

test('sheet cells use canonical down-left-right-up rows', () => {
  assert.deepEqual(sheetSource('down', 'idle'), { x: 0, y: 0, width: 48, height: 72 })
  assert.deepEqual(sheetSource('left', 'stepL'), { x: 48, y: 72, width: 48, height: 72 })
  assert.deepEqual(sheetSource('right', 'stepR'), { x: 96, y: 144, width: 48, height: 72 })
  assert.deepEqual(sheetSource('up', 'idle'), { x: 0, y: 216, width: 48, height: 72 })
})

test('mount and dismount transitions remain bounded around the foot anchor', () => {
  const mount = { phase: 'mount', startedAt: 1000, dir: 'right' }
  const mountMid = rideTransitionPose(mount, 1000 + MOUNT_DURATION / 2)
  assert.ok(mountMid.active)
  assert.ok(mountMid.hop < 0)
  assert.ok(mountMid.liftMix > 0 && mountMid.liftMix <= 1)
  assert.ok(Math.abs(mountMid.rotation) <= 0.025)

  const dismount = { phase: 'dismount', startedAt: 2000, dir: 'left' }
  const dismountMid = rideTransitionPose(dismount, 2000 + DISMOUNT_DURATION / 2)
  assert.ok(dismountMid.active)
  assert.ok(dismountMid.offsetX < 0)
  assert.ok(dismountMid.hop >= -8)
  assert.equal(rideTransitionPose(dismount, 2000 + DISMOUNT_DURATION + 1).active, false)
})

test('reduced motion resolves ride transitions immediately', () => {
  const pose = rideTransitionPose({ phase: 'mount', startedAt: 0, dir: 'right' }, 1, true)
  assert.equal(pose.active, false)
  assert.equal(pose.liftMix, 1)
  assert.equal(pose.rotation, 0)
})
