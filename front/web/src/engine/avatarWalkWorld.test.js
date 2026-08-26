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

test('world loads matching stills and walk sheets under one cache-busting build id', async () => {
  const sources = []
  const OriginalImage = globalThis.Image
  globalThis.Image = class {
    set src(value) {
      sources.push(value)
      queueMicrotask(() => this.onload?.())
    }
  }
  try {
    const engine = new Engine(
      { getContext: () => ({}) },
      {
        maps: {
          office: { spawn: [2, 2], collision: [] },
          arcade: { spawn: [2, 2], collision: [] }
        },
        walkManifest: { buildPixelSha256: 'canonical-v3' }
      }
    )
    await engine.load(['v01'])
    assert.ok(sources.includes('/assets/sprites_v2/v01/left.png?v=canonical-v3'))
    assert.ok(sources.includes('/assets/sprites_v2/v01/right.png?v=canonical-v3'))
    assert.ok(sources.includes('/assets/sprites_v2/v01/walk-sheet.png?v=canonical-v3'))
  } finally {
    if (OriginalImage === undefined) delete globalThis.Image
    else globalThis.Image = OriginalImage
  }
})

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

test('evaluation visitors face their actual horizontal route displacement', () => {
  const engine = makeEngine()
  const visitor = engine.addAgent('v01', 'v01', [2, 2], { map: 'office', autonomy: false })

  const startX = visitor.x
  visitor.path = [[3, 2]]
  engine._moveAgentAlongPath(visitor, 1)
  assert.ok(visitor.x > startX)
  assert.equal(visitor.dir, 'right')

  visitor.path = [[1, 2]]
  engine._moveAgentAlongPath(visitor, 1)
  assert.equal(visitor.dir, 'left')
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
