# NPC autonomy contract

`Engine` runs known team members and visitors through a bounded
`observe → utility goal → plan → act → feedback` loop. Scripted meeting calls
to `goTo`/`sit` keep deterministic control and temporarily pause autonomy.

## Configure an actor

```js
world.enableAutonomy('dev2', {
  profiles: ['team', 'dev2'],
  weights: { portablePlay: 1.1, socialize: 0.8 }
})

world.configureAutonomy('v03', {
  profiles: ['visitor', 'scoreHunter'],
  limits: { maxReplansPerWindow: 4 }
})
```

Profile keys and goal names are exported from `npcPlanner.js`. Runtime state is
available through `world.getAutonomyState(id)` and the JSON-safe
`entity.meta.autonomy` snapshot.

## Assign a simulation goal

```js
const handle = world.enqueueNpcGoal('v03', {
  kind: 'play-game',
  venue: 'cabinet', // or `handheld`
  target: cabinet.spot,
  gameId: game.id,
  title: game.title,
  maxDurationMs: 9000,
  maxReplans: 3,
  allowDuringSim: true,
  onArrive: ({ agent, activity }) => startBotRun(agent, activity)
})

const report = await handle.promise
// { status, reason, routePlan, evidence, replans, timeout, elapsedMs }
```

`kind:'return-to-desk'` is normalized to a return-home plan. `onArrive` runs
exactly once when the route reaches its target (or when a targetless activity
starts). `handle.cancel()` resolves the same promise with `status:'cancelled'`.

## Handheld renderer contract

```js
world.setHandheld(agentId, {
  active: true,
  state: 'playing',
  gameId: game.id,
  title: game.title
})

world.setHandheld(agentId, null)
```

The renderer reads `entity.meta.handheld`. Planner-owned portable-play goals
set and clear it automatically.

## Loop and collision guards

- Plans have at most four actions and each goal/action has a wall-clock cap.
- Replans use a sliding-window budget; exhausted actors perform a short idle
  fallback before observing again.
- Failed goals and targets receive cooldowns, and recent repeats lose utility.
- Lost routes and stationary actors trigger bounded replans, then fail safely.
- `meta.reactionLockUntil` or `meta.reactionUntil` pauses planning and its
  timeout clock. A cleared route replans after the reaction instead of looping.
- Planner movement alone uses line-of-sight path smoothing, slight per-agent
  speed variance and low-pass separation. Scripted meeting seating is unchanged.
