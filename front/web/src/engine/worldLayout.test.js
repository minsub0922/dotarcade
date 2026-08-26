import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dynamicAvoidTiles,
  layoutOccluders,
  navigationGridWithAvoid,
  occupiedEntityTiles,
  randomWalkableAvoiding
} from './worldLayout.js'

const map = {
  collision: ['.....', '.....', '.....'],
  layout: {
    dynamicAvoid: [
      { id: 'bike', tile: [1, 1], radiusTiles: .65 },
      { id: 'book', tile: [3, 1], radiusTiles: .65 }
    ],
    occluders: [{ id: 'sofa', source: [10, 20, 30, 40], baseline: 60 }]
  }
}

test('dynamic avoid follows settled props and releases held or mounted objects', () => {
  const live = [
    { id: 'bike', map: 'office', x: 120, y: 72, mounted: false },
    { id: 'book', map: 'office', x: 168, y: 72, held: true }
  ]
  const avoid = dynamicAvoidTiles(map, live, 'office', 48)
  assert.equal(avoid.has('2,1'), true)
  assert.equal(avoid.has('1,1'), false)
  assert.equal(avoid.has('3,1'), false)
})

test('large vehicles reserve cardinal neighbor cells without closing diagonals', () => {
  const vehicleMap = {
    collision: ['.....', '.....', '.....'],
    layout: { dynamicAvoid: [{ id: 'bike', tile: [2, 1], radiusTiles: 1.1 }] }
  }
  const avoid = dynamicAvoidTiles(vehicleMap, [], 'office', 48)
  for (const key of ['2,1', '1,1', '3,1', '2,0', '2,2']) assert.equal(avoid.has(key), true)
  assert.equal(avoid.has('1,0'), false)
})

test('airborne props are ignored until their settled floor position is stable', () => {
  const thrown = [{ id: 'book', map: 'office', x: 168, y: 72, z: 24, vx: 8, vy: 0 }]
  const avoid = dynamicAvoidTiles(map, thrown, 'office', 48)
  assert.equal(avoid.has('3,1'), false)
  thrown[0].z = 0; thrown[0].vx = 0
  assert.equal(dynamicAvoidTiles(map, thrown, 'office', 48).has('3,1'), true)
})

test('NPC grid reserves prop anchors without changing the player collision map', () => {
  const grid = navigationGridWithAvoid(map, [], 'office', 48)
  assert.equal(grid[1], '.#.#.')
  assert.equal(map.collision[1], '.....')
  const kept = navigationGridWithAvoid(map, [], 'office', 48, [[1, 1]])
  assert.equal(kept[1], '...#.')
})

test('random destination selection never returns a reserved tile', () => {
  const avoid = new Set(['0,0', '1,0', '2,0', '3,0'])
  assert.deepEqual(randomWalkableAvoiding(['.....'], [0, 0, 4, 0], avoid, () => 0), [4, 0])
})

test('ambient destinations reserve actor positions and their planned goals', () => {
  const occupied = occupiedEntityTiles([
    {
      visible: true,
      map: 'arcade',
      x: 2 * 48 + 24,
      y: 48 + 42,
      autonomy: { currentGoal: { targetTile: [4, 1] } }
    },
    { visible: true, map: 'office', x: 24, y: 42 }
  ], 'arcade')
  for (const key of ['2,1', '1,1', '3,1', '2,0', '2,2', '4,1', '5,1']) {
    assert.equal(occupied.has(key), true)
  }
  assert.equal(occupied.has('0,0'), false)
})

test('occluder metadata is copied before entering the render scene', () => {
  const result = layoutOccluders(map)
  assert.deepEqual(result, [{ id: 'sofa', source: [10, 20, 30, 40], baseline: 60 }])
  result[0].source[0] = 999
  assert.equal(map.layout.occluders[0].source[0], 10)
})
