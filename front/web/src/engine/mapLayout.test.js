import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PORTABLE_SPOTS } from '../arcade/portable.js'
import { Engine } from './world.js'

const mapsPath = fileURLToPath(new URL('../../public/assets/maps.json', import.meta.url))
const maps = JSON.parse(readFileSync(mapsPath, 'utf8'))

const key = ([x, y]) => `${x},${y}`
const cells = ([x, y, w, h]) => {
  const result = []
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) result.push([xx, yy])
  }
  return result
}
const isWalkable = (map, [x, y]) => map.collision[y]?.[x] === '.'

function reachable(map, start) {
  const seen = new Set([key(start)])
  const queue = [start]
  while (queue.length) {
    const [x, y] = queue.shift()
    for (const next of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = key(next)
      if (!seen.has(k) && isWalkable(map, next)) {
        seen.add(k)
        queue.push(next)
      }
    }
  }
  return seen
}

test('map grids and 48x72 avatar scale contract stay stable', () => {
  assert.equal(maps.tile, 48)
  assert.equal(maps.w, 30)
  assert.equal(maps.h, 20)
  for (const name of ['office', 'arcade']) {
    const map = maps[name]
    assert.equal(map.collision.length, maps.h)
    map.collision.forEach(row => assert.equal(row.length, maps.w))
    assert.deepEqual(map.layout.avatarReference.frame, [48, 72])
    assert.deepEqual(map.layout.avatarReference.footprint, [24, 10])
    assert.equal(map.layout.avatarReference.anchor, 'feet')
  }
})

test('every furniture footprint is collision-solid and furniture zones never overlap', () => {
  for (const name of ['office', 'arcade']) {
    const map = maps[name]
    const occupied = new Map()
    for (const furniture of map.layout.furniture) {
      for (const tile of cells(furniture.footprint)) {
        assert.equal(
          map.collision[tile[1]]?.[tile[0]],
          '#',
          `${name}:${furniture.id} must block ${key(tile)}`
        )
        assert.equal(
          occupied.has(key(tile)),
          false,
          `${name}:${furniture.id} overlaps ${occupied.get(key(tile))} at ${key(tile)}`
        )
        occupied.set(key(tile), furniture.id)
      }
      if (furniture.interaction) {
        assert.equal(isWalkable(map, furniture.interaction), true, `${name}:${furniture.id} interaction must stay open`)
      }
    }
  }
})

test('declared aisles keep at least two clear tiles and remain fully walkable', () => {
  for (const name of ['office', 'arcade']) {
    const map = maps[name]
    for (const aisle of map.layout.aisles) {
      const [, , width, height] = aisle.tiles
      assert.ok(Math.min(width, height) >= map.layout.minAisleTiles, `${name}:${aisle.id} is too narrow`)
      for (const tile of cells(aisle.tiles)) {
        assert.equal(isWalkable(map, tile), true, `${name}:${aisle.id} is blocked at ${key(tile)}`)
      }
    }
  }
})

test('all interaction coordinates remain walkable and reachable from spawn', () => {
  const office = maps.office
  const officePois = [
    office.spawn,
    ...Object.values(office.seats).map(seat => seat.desk),
    ...office.meeting.seats,
    office.meeting.head,
    ...office.shelf.front,
    ...office.door.tiles,
    ...office.door.approach,
    [9, 17], // DOTCADE POCKET approach
    [21, 16], [25, 16], // office bicycle / scooter
  ]
  const arcade = maps.arcade
  const arcadePois = [
    arcade.spawn,
    ...arcade.door.tiles,
    ...arcade.door.approach,
    ...arcade.cabinets.map(cabinet => cabinet.spot),
    [21, 15], [18, 15], // arcade bicycle / scooter
  ]

  for (const [name, map, pois] of [
    ['office', office, officePois],
    ['arcade', arcade, arcadePois],
  ]) {
    const reached = reachable(map, map.spawn)
    for (const poi of pois) {
      assert.equal(isWalkable(map, poi), true, `${name} POI ${key(poi)} must stay walkable`)
      assert.equal(reached.has(key(poi)), true, `${name} POI ${key(poi)} must remain reachable`)
    }
  }
})

test('meeting lead and cabinet spots sit outside furniture at visually centred anchors', () => {
  assert.deepEqual(maps.office.meeting.head, [2, 7])
  assert.equal(maps.office.meeting.headFace, 'right')
  assert.deepEqual(
    maps.arcade.cabinets.map(({ id, tiles, spot }) => ({ id, tiles, spot })),
    [
      { id: 0, tiles: [3, 3, 2, 2], spot: [4, 5] },
      { id: 1, tiles: [8, 3, 2, 2], spot: [9, 5] },
      { id: 2, tiles: [13, 3, 2, 2], spot: [14, 5] },
      { id: 3, tiles: [18, 3, 2, 2], spot: [19, 5] },
      { id: 4, tiles: [23, 3, 2, 2], spot: [24, 5] },
      { id: 5, tiles: [27, 7, 2, 2], spot: [26, 7] },
      { id: 6, tiles: [27, 11, 2, 2], spot: [26, 11] },
      { id: 7, tiles: [27, 15, 2, 2], spot: [26, 15] },
    ]
  )
})

test('portable, vehicles and throwable props are dynamic avoidance anchors, not static walls', () => {
  for (const name of ['office', 'arcade']) {
    const map = maps[name]
    const reached = reachable(map, map.spawn)
    assert.deepEqual(
      map.layout.dynamicAvoid.map(item => item.id),
      map.layout.reserved.map(item => item.id)
    )
    for (const reserved of map.layout.reserved) {
      assert.equal(isWalkable(map, reserved.tile), true, `${name}:${reserved.id} must remain on walkable floor`)
      assert.equal(reached.has(key(reserved.tile)), true, `${name}:${reserved.id} must remain reachable`)
      const dynamic = map.layout.dynamicAvoid.find(item => item.id === reserved.id)
      assert.deepEqual(dynamic.tile, reserved.tile)
      assert.ok(dynamic.radiusTiles > 0 && dynamic.radiusTiles <= 1.1)
      if (reserved.kind === 'bicycle') assert.ok(dynamic.radiusTiles > 1)
      if (reserved.kind === 'scooter') assert.ok(dynamic.radiusTiles >= 1.05)
    }
  }
})

test('enlarged vehicles fit every declared parking anchor and portable targets do not share them', () => {
  const engine = new Engine({
    width: 1440,
    height: 960,
    getContext: () => ({ imageSmoothingEnabled: false })
  }, { maps })
  const parked = new Set()
  for (const object of engine.worldObjects.filter(item => item.mountable)) {
    engine.map = object.map
    assert.equal(
      engine._vehicleWalkable(object.x, object.y, object.kind, object.dir),
      true,
      `${object.id} must fit its enlarged wheel envelope at ${key(object.tile)}`
    )
    parked.add(`${object.map}:${key(object.tile)}`)
  }
  for (const [mapName, spots] of Object.entries(PORTABLE_SPOTS)) {
    for (const spot of spots) {
      assert.equal(isWalkable(maps[mapName], spot), true, `${mapName} portable spot ${key(spot)} must stay open`)
      assert.equal(parked.has(`${mapName}:${key(spot)}`), false, `${mapName} portable spot must not share a vehicle anchor`)
    }
  }
})

test('v2 foreground crops are bounded and use entity-foot baselines', () => {
  const pixelWidth = maps.w * maps.tile
  const pixelHeight = maps.h * maps.tile
  for (const name of ['office', 'arcade']) {
    for (const occluder of maps[name].layout.occluders) {
      const [x, y, width, height] = occluder.source
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0, `${name}:${occluder.id} invalid crop`)
      assert.ok(x + width <= pixelWidth && y + height <= pixelHeight, `${name}:${occluder.id} exceeds bitmap`)
      assert.ok(occluder.baseline >= y, `${name}:${occluder.id} baseline must use world foot y`)
      assert.ok(occluder.baseline <= y + height + maps.tile, `${name}:${occluder.id} baseline is detached from crop`)
    }
  }

  for (const desk of maps.office.layout.furniture.filter(item => item.kind === 'desk')) {
    const occluder = maps.office.layout.occluders.find(item => item.id === `${desk.id}-front`)
    assert.ok(occluder, `${desk.id} needs a measured foreground crop`)
    const seatFootY = desk.interaction[1] * maps.tile + maps.tile - 6
    assert.ok(
      seatFootY > occluder.baseline,
      `${desk.id} seated avatar must render after the rectangular crop`
    )
  }
})
