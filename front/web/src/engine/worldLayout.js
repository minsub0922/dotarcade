const tileKey = (x, y) => `${x},${y}`

function liveObjectTile(entry, worldObjects, mapName, tileSize) {
  const object = worldObjects.find(item => item.id === entry.id && item.map === mapName)
  if (!object) return entry.tile
  if (object.held || object.mounted) return null
  if ((Number(object.z) || 0) > 2 || Math.hypot(Number(object.vx) || 0, Number(object.vy) || 0) > .2) return null
  return [Math.floor(object.x / tileSize), Math.floor(object.y / tileSize)]
}

// Props remain walkable so the player can approach and use them, but NPC
// planners should not choose their exact floor cells as idle destinations.
// Resolve against the live object position so a thrown book is not avoided at
// its old spawn forever.
export function dynamicAvoidTiles(map, worldObjects = [], mapName = '', tileSize = 48) {
  const blocked = new Set()
  for (const entry of map?.layout?.dynamicAvoid || []) {
    const tile = liveObjectTile(entry, worldObjects, mapName, tileSize)
    if (!tile) continue
    const radius = Math.max(0, Number(entry.radiusTiles) || 0)
    const reach = Math.ceil(radius)
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (Math.hypot(dx, dy) <= radius + 0.001) blocked.add(tileKey(tile[0] + dx, tile[1] + dy))
      }
    }
    // A radius below one tile still reserves the object's own anchor.
    blocked.add(tileKey(tile[0], tile[1]))
  }
  return blocked
}

export function navigationGridWithAvoid(map, worldObjects = [], mapName = '', tileSize = 48, keepTiles = []) {
  const avoid = dynamicAvoidTiles(map, worldObjects, mapName, tileSize)
  for (const [x, y] of keepTiles || []) avoid.delete(tileKey(x, y))
  return (map?.collision || []).map((row, y) => [...row].map((cell, x) => (
    cell === '.' && avoid.has(tileKey(x, y)) ? '#' : cell
  )).join(''))
}

export function randomWalkableAvoiding(grid, zone, avoid = new Set(), rng = Math.random) {
  if (!grid?.length || !zone) return null
  const [x0, y0, x1, y1] = zone
  const candidates = []
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (grid[y]?.[x] === '.' && !avoid.has(tileKey(x, y))) candidates.push([x, y])
    }
  }
  if (!candidates.length) return null
  const unit = Math.max(0, Math.min(0.999999999, Number(rng()) || 0))
  return candidates[Math.floor(unit * candidates.length)]
}

// Ambient actors choose goals independently, so merely avoiding furniture can
// send several of them to the same lounge tile. Reserve both their current
// cells and already-planned destinations, including cardinal neighbours. This
// keeps bodies/name chips readable without turning NPCs into hard collision
// walls while they are actually walking.
export function occupiedEntityTiles(entities = [], mapName = '', tileSize = 48, radiusTiles = 1.05) {
  const occupied = new Set()
  const reserve = tile => {
    if (!Array.isArray(tile) || tile.length < 2) return
    const [tx, ty] = tile.map(Number)
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return
    const reach = Math.ceil(Math.max(0, radiusTiles))
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (Math.hypot(dx, dy) <= radiusTiles + 0.001) occupied.add(tileKey(tx + dx, ty + dy))
      }
    }
  }
  for (const entity of entities || []) {
    if (!entity?.visible || (entity.map && entity.map !== mapName)) continue
    if (Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
      reserve([Math.floor(entity.x / tileSize), Math.floor(entity.y / tileSize)])
    }
    reserve(entity.autonomy?.currentGoal?.targetTile)
  }
  return occupied
}

export function layoutOccluders(map) {
  return (map?.layout?.occluders || [])
    .filter(item => Array.isArray(item.source) && item.source.length === 4 && Number.isFinite(item.baseline))
    .map(item => ({ ...item, source: [...item.source] }))
}
