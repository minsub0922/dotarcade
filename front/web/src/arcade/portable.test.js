import test from 'node:test'
import assert from 'node:assert/strict'
import { VISITORS } from '../data/personas.js'
import { portableVenueFor, routeAgentBounded } from './portable.js'

test('evaluation venue mix keeps handheld play visible without replacing cabinets', () => {
  const venues = VISITORS.map((visitor, index) => portableVenueFor(visitor, index))
  const handheldCount = venues.filter(venue => venue === 'handheld').length

  assert.ok(handheldCount >= 6 && handheldCount <= 10, `handheld count ${handheldCount} must stay in [6, 10]`)
  for (let start = 0; start < VISITORS.length; start += 5) {
    assert.equal(venues.slice(start, start + 5).filter(venue => venue === 'handheld').length, 2)
  }
})

test('portable route delegates to the autonomous planner once and records evidence', async () => {
  const target = [8, 14]
  const entity = { x: target[0] * 48 + 24, y: target[1] * 48 + 42, meta: {} }
  let calls = 0
  const world = {
    agent: () => entity,
    enqueueNpcGoal: (_id, request) => {
      calls += 1
      entity.meta.autonomyAssignment = {
        id: 'goal-1', status: 'playing', routePlan: [[7, 14], target], replans: 0,
        evidence: [{ type: 'assigned', venue: request.venue, target }, { type: 'arrived', activity: 'portablePlay' }]
      }
      queueMicrotask(() => request.onArrive())
      return { id: 'goal-1', promise: Promise.resolve({ status: 'arrived' }), cancel: () => true }
    }
  }

  const result = await routeAgentBounded(world, 'v02', target, { timeoutMs: 200, maxReplans: 1 })
  assert.equal(calls, 1)
  assert.equal(result.planner, 'autonomous-goal-planner')
  assert.equal(result.plannerGoalId, 'goal-1')
  assert.equal(result.arrived, true)
  assert.ok(result.evidence.some(line => line.includes('플래너 도착 확인')))
})

test('fallback route stops after its finite replan budget', async () => {
  const entity = { x: 24, y: 42, meta: {} }
  let calls = 0
  const world = { agent: () => entity, goTo: () => { calls += 1 } }
  const result = await routeAgentBounded(world, 'v03', [12, 12], { timeoutMs: 60, maxReplans: 1 })

  assert.equal(result.arrived, false)
  assert.equal(result.status, 'timeout')
  assert.equal(result.replans, 1)
  assert.equal(calls, 2)
})

test('planner route cancels its accepted goal when the watchdog expires', async () => {
  const entity = { x: 24, y: 42, meta: {} }
  let cancels = 0
  const world = {
    agent: () => entity,
    enqueueNpcGoal: () => ({
      id: 'stalled-goal',
      promise: new Promise(() => {}),
      cancel: () => { cancels += 1 }
    })
  }

  const result = await routeAgentBounded(world, 'v04', [14, 12], { timeoutMs: 45, maxReplans: 1 })

  assert.equal(result.status, 'timeout')
  assert.equal(cancels, 1)
})
