import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AVATAR_ANCHOR,
  WALK_SEQUENCE,
  DISMOUNT_DURATION,
  MOUNT_DURATION,
  avatarDrawLayout,
  createWalkState,
  directionFromDelta,
  isWalkSheetCompatible,
  rideDirectionFromDelta,
  rideLayout,
  rideTransitionPose,
  sampleRideCycle,
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

test('ride direction uses hysteresis around diagonal steering', () => {
  assert.equal(rideDirectionFromDelta(4, 4.5, 'right'), 'right')
  assert.equal(rideDirectionFromDelta(4, 5.2, 'right'), 'down')
  assert.equal(rideDirectionFromDelta(5.2, -4, 'up'), 'right')
  assert.equal(rideDirectionFromDelta(-5.2, 4, 'down'), 'left')
})

test('bicycle layout mirrors the saddle and grips while preserving a seated waist anchor', () => {
  const right = rideLayout('bicycle', 'right')
  const left = rideLayout('bicycle', 'left')
  assert.equal(right.seated, true)
  assert.ok(right.cropRatio < 0.8)
  assert.equal(left.hip.x, -right.hip.x)
  assert.equal(left.handles[0].x, -right.handles[0].x)
  assert.equal(left.lean, -right.lean)

  const down = rideLayout('bicycle', 'down')
  const up = rideLayout('bicycle', 'up')
  assert.ok(down.cropRatio < right.cropRatio)
  assert.equal(up.cropRatio, down.cropRatio)
  const downReach = (down.handles[0].y - down.hip.y) * down.forward.y
  const upReach = (up.handles[0].y - up.hip.y) * up.forward.y
  assert.ok(downReach > 0)
  assert.ok(upReach > 0)
})

test('ride cycle is travelled-distance driven and freezes while reduced', () => {
  const start = sampleRideCycle(0, true, 'bicycle')
  const advanced = sampleRideCycle(90, true, 'bicycle')
  assert.notEqual(advanced.pedalPhase, start.pedalPhase)
  assert.notEqual(advanced.wheelPhase, start.wheelPhase)
  assert.deepEqual(sampleRideCycle(90, true, 'bicycle', true), {
    pedalPhase: Math.PI / 4,
    wheelPhase: 0,
    kick: 0,
    bob: 0
  })
})

test('scaled wheels roll without slip and scooter travel drives a kick cycle', () => {
  const bicycle = sampleRideCycle(14.6, true, 'bicycle')
  assert.ok(Math.abs(bicycle.wheelPhase - 1) < 0.001)
  const scooter = sampleRideCycle(44 * Math.PI / 2, true, 'scooter')
  assert.ok(scooter.kick > 0.99)
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

test('standing sprite layout locks the authored foot anchor to world y', () => {
  const player = avatarDrawLayout({
    sourceWidth: 48,
    sourceHeight: 72,
    targetWidth: 54,
    targetHeight: 82
  })
  assert.deepEqual([player.drawW, player.drawH], [54, 81])
  assert.equal(player.offsetX + player.anchorX, 0)
  assert.equal(player.offsetY + player.anchorY, 0)
  assert.equal(player.anchorY, Math.round(player.drawH * AVATAR_ANCHOR.y / 72))

  const npc = avatarDrawLayout({
    sourceWidth: 48,
    sourceHeight: 72,
    targetWidth: 52,
    targetHeight: 79
  })
  assert.deepEqual([npc.drawW, npc.drawH], [52, 78])
  assert.equal(npc.offsetY + npc.anchorY, 0)
})

test('walking renderer accepts only the canonical sheet packing', () => {
  assert.equal(isWalkSheetCompatible({ width: 144, height: 288 }), true)
  assert.equal(isWalkSheetCompatible({ naturalWidth: 144, naturalHeight: 288, width: 1, height: 1 }), true)
  assert.equal(isWalkSheetCompatible({ width: 144, height: 216 }), false)
  assert.equal(isWalkSheetCompatible({ width: 192, height: 288 }), false)
  assert.equal(isWalkSheetCompatible(null), false)
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
