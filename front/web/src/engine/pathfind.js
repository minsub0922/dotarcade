// DOTCADE — 그리드 A* 경로찾기
export function astar(grid, start, goal) {
  // grid: string[] ('#'=벽), start/goal: [tx,ty]
  const H = grid.length, W = grid[0].length
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && grid[y][x] !== '#'
  if (!walk(goal[0], goal[1])) {
    // 목표가 막혀있으면 인접 타일로
    const alt = neighbors(goal[0], goal[1]).find(([x, y]) => walk(x, y))
    if (!alt) return null
    goal = alt
  }
  function neighbors(x, y) { return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]] }
  const key = (x, y) => y * W + x
  const open = new Map(); const came = new Map(); const g = new Map()
  const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1])
  const sk = key(start[0], start[1])
  g.set(sk, 0); open.set(sk, { x: start[0], y: start[1], f: h(start[0], start[1]) })
  let guard = 0
  while (open.size && guard++ < 4000) {
    let bestK = null, best = null
    for (const [k, n] of open) if (!best || n.f < best.f) { best = n; bestK = k }
    open.delete(bestK)
    if (best.x === goal[0] && best.y === goal[1]) {
      const path = [[best.x, best.y]]
      let ck = bestK
      while (came.has(ck)) { ck = came.get(ck); path.unshift([ck % W, Math.floor(ck / W)]) }
      path.shift()
      return path
    }
    for (const [nx, ny] of neighbors(best.x, best.y)) {
      if (!walk(nx, ny)) continue
      const nk = key(nx, ny)
      const ng = g.get(bestK) + 1
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, bestK)
        open.set(nk, { x: nx, y: ny, f: ng + h(nx, ny) })
      }
    }
  }
  return null
}

export function randomWalkable(grid, zone, rng = Math.random) {
  const [x0, y0, x1, y1] = zone
  for (let i = 0; i < 60; i++) {
    const x = x0 + Math.floor(rng() * (x1 - x0 + 1))
    const y = y0 + Math.floor(rng() * (y1 - y0 + 1))
    if (grid[y] && grid[y][x] === '.') return [x, y]
  }
  return null
}
