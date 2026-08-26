import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEUTRAL_AVATAR_WALK_POSE,
  createAvatarWalkMotionState,
  sampleAvatarWalkMotion
} from './avatarWalkMotion.js'

const advance = (state, options, frames = 30) => {
  let pose
  for (let frame = 0; frame < frames; frame++) {
    pose = sampleAvatarWalkMotion(state, options)
  }
  return pose
}

test('walk motion eases in and settles without moving the foot anchor', () => {
  const state = createAvatarWalkMotionState()
  const started = sampleAvatarWalkMotion(state, {
    distance: 22, direction: 'down', speed: 3, moving: true, deltaMs: 16.67
  })
  assert.ok(started.mix > 0 && started.mix < 1)
  assert.equal(started.y, 0)

  const walking = advance(state, {
    distance: 22, direction: 'down', speed: 3, moving: true, deltaMs: 16.67
  })
  assert.ok(walking.mix > .99)
  assert.equal(walking.y, 0)

  const settling = sampleAvatarWalkMotion(state, {
    distance: 22, direction: 'down', speed: 3, moving: false, deltaMs: 16.67
  })
  assert.ok(settling.mix > 0 && settling.mix < walking.mix)
  const stopped = advance(state, {
    distance: 22, direction: 'down', speed: 3, moving: false, deltaMs: 50
  })
  assert.deepEqual(stopped, NEUTRAL_AVATAR_WALK_POSE)
})

test('horizontal forward lean mirrors with direction and remains distance driven', () => {
  const right = advance(createAvatarWalkMotionState(), {
    distance: 22, direction: 'right', speed: 3, moving: true, deltaMs: 50
  })
  const left = advance(createAvatarWalkMotionState(), {
    distance: 22, direction: 'left', speed: 3, moving: true, deltaMs: 50
  })
  assert.ok(right.rotation > 0)
  assert.ok(left.rotation < 0)
  assert.ok(Math.abs(right.rotation + left.rotation) < 1e-10)

  const later = advance(createAvatarWalkMotionState(), {
    distance: 44, direction: 'down', speed: 3, moving: true, deltaMs: 50
  })
  assert.notEqual(Math.sign(right.stride), Math.sign(later.stride))
})

test('suppression, teleports and reduced-motion preference cancel secondary motion immediately', () => {
  const state = createAvatarWalkMotionState()
  advance(state, { distance: 22, moving: true, deltaMs: 50 })
  assert.deepEqual(sampleAvatarWalkMotion(state, {
    distance: 24, moving: true, paused: true
  }), NEUTRAL_AVATAR_WALK_POSE)

  advance(state, { distance: 44, moving: true, deltaMs: 50 })
  assert.deepEqual(sampleAvatarWalkMotion(state, {
    distance: 44, moving: true, reset: true
  }), NEUTRAL_AVATAR_WALK_POSE)

  advance(state, { distance: 44, moving: true, deltaMs: 50 })
  assert.deepEqual(sampleAvatarWalkMotion(state, {
    distance: 48, moving: true, reduceMotion: true
  }), NEUTRAL_AVATAR_WALK_POSE)
})

test('all directions and supported speeds stay inside restrained render bounds', () => {
  for (const direction of ['down', 'left', 'right', 'up']) {
    for (const speed of [0, 3, 4.4, 12]) {
      for (const distance of [0, 9, 18, 27, 72, 500]) {
        const pose = advance(createAvatarWalkMotionState(), {
          distance, direction, speed, moving: true, deltaMs: 50
        })
        assert.equal(pose.y, 0)
        assert.equal(pose.x, 0)
        assert.ok(Math.abs(pose.rotation) <= .016)
        assert.ok(Math.abs(pose.shearX) <= .009)
        assert.ok(pose.scaleX >= 1 && pose.scaleX <= 1.006)
        assert.ok(pose.scaleY >= .991 && pose.scaleY <= 1)
        assert.ok(pose.shadowScaleX >= .925 && pose.shadowScaleX <= 1)
        assert.ok(pose.shadowScaleY >= .89 && pose.shadowScaleY <= 1)
        assert.ok(pose.shadowAlpha >= .92 && pose.shadowAlpha <= 1)
      }
    }
  }
})
