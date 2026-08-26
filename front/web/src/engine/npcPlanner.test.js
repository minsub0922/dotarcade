import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NPC_GOALS,
  createAutonomyState,
  buildBoundedPlan,
  consumeReplanBudget,
  sampleStuck,
  smoothTilePath,
  hasTileLineOfSight
} from './npcPlanner.js'

test('bounded plans never exceed the configured maximum', () => {
  const goal = { kind: NPC_GOALS.WORK, targetTile: [8, 7], face: 'up', durationMs: 5000 }
  const plan = buildBoundedPlan(goal, { maxPlanLength: 2, maxActionMs: 11000 })
  assert.equal(plan.length, 2)
  assert.deepEqual(plan.map(step => step.kind), ['move', 'sit'])
})

test('the sixth replan inside one window is blocked', () => {
  const state = createAutonomyState({ now: 1000 })
  for (let i = 0; i < state.limits.maxReplansPerWindow; i++) {
    assert.equal(consumeReplanBudget(state, 1000 + i * 100), true)
  }
  assert.equal(consumeReplanBudget(state, 1700), false)
  assert.ok(state.blockedUntil > 1700)
})

test('stuck detection only fires after the bounded timeout', () => {
  const state = createAutonomyState({ now: 1000 })
  state.limits.stuckSampleMs = 100
  state.limits.stuckTimeoutMs = 250
  const entity = { x: 24, y: 42 }
  assert.equal(sampleStuck(state, entity, 3, 1000), false)
  assert.equal(sampleStuck(state, entity, 3, 1110), false)
  assert.equal(sampleStuck(state, entity, 3, 1220), false)
  assert.equal(sampleStuck(state, entity, 3, 1370), true)
})

test('path smoothing keeps every shortcut collision safe', () => {
  const grid = [
    '#########',
    '#.......#',
    '#..###..#',
    '#.......#',
    '#########'
  ]
  const start = [1, 1]
  const raw = [[2, 1], [2, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3]]
  const smooth = smoothTilePath(grid, start, raw, 6)
  assert.deepEqual(smooth.at(-1), raw.at(-1))
  assert.ok(smooth.length <= raw.length)
  let from = start
  for (const waypoint of smooth) {
    assert.equal(hasTileLineOfSight(grid, from, waypoint), true)
    from = waypoint
  }
})
