import test from 'node:test'
import assert from 'node:assert/strict'
import { Engine } from './world.js'
import { NEUTRAL_AVATAR_WALK_POSE } from './avatarWalkMotion.js'

const makeEngine = () => new Engine(
  { getContext: () => ({}) },
  {
    maps: {
      office: { spawn: [2, 2], collision: [] },
      arcade: { spawn: [2, 2], collision: [] }
    }
  }
)

test('world samples actual displacement without changing collision or sort coordinates', () => {
  const engine = makeEngine()
  const player = engine.player
  const y = player.y
  player.x += 22
  player.moving = true

  engine._sampleAvatarWalk(player, 16.67)

  assert.equal(player.walkAnimation.advanced, true)
  assert.ok(player.walkMotion.pose.mix > 0)
  assert.equal(player.walkMotion.pose.x, 0)
  assert.equal(player.walkMotion.pose.y, 0)
  assert.equal(player.y, y)

  player.x += 120
  engine._sampleAvatarWalk(player, 16.67)
  assert.equal(player.walkAnimation.teleported, true)
  assert.deepEqual(player.walkMotion.pose, NEUTRAL_AVATAR_WALK_POSE)
})
test('world suppresses walking during reactions, seats, rides and reduced motion', () => {
  const scenarios = [
    (engine, entity) => { entity.sitting = true },
    (engine, entity) => { entity.meta.reactionUntil = engine.t + 1000 },
    (engine) => { engine.mountedVehicleId = 'office-bike' },
    (engine) => { engine.player.meta.rideMotion = { phase: 'dismount', startedAt: engine.t, kind: 'bicycle', dir: 'right' } },
    (engine) => { engine.reduceMotion = true }
  ]

  for (const configure of scenarios) {
    const engine = makeEngine()
    const player = engine.player
    player.x += 22
    player.moving = true
    engine._sampleAvatarWalk(player, 16.67)
    configure(engine, player)
    player.x += 4
    engine._sampleAvatarWalk(player, 16.67)
    assert.equal(player.walkAnimation.advanced, false)
    assert.deepEqual(player.walkMotion.pose, NEUTRAL_AVATAR_WALK_POSE)
  }
})
