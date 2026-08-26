// Portable play helpers shared by the world simulation and office ambience.
// The helpers prefer the autonomous planner API when it exists, but keep a
// bounded A* fallback so the evaluation pipeline never waits forever.

export const PORTABLE_SPOTS = {
  office: [[11, 12], [23, 14], [10, 17], [23, 17]],
  arcade: [[11, 7], [17, 8], [8, 14], [21, 14], [24, 12]]
}

const tileDistance = (entity, tile) => {
  if (!entity || !tile) return Infinity
  return Math.hypot(entity.x / 48 - (tile[0] + .5), entity.y / 48 - (tile[1] + .875))
}

export const portableVenueFor = (visitor, index = 0) => {
  // Stable per-person assignment: reproducible evaluation while still mixing
  // cabinets and handhelds in every five-strategy cohort.
  const idNumber = Number(String(visitor?.id || '').replace(/\D/g, '')) || index + 1
  const cohortSlot = (idNumber - 1 + Math.floor(index / 5)) % 5
  return cohortSlot === 1 || cohortSlot === 4 ? 'handheld' : 'cabinet'
}

export const venueLabel = venue => venue === 'handheld' ? '휴대 게임기' : '아케이드 캐비닛'
export const venueIcon = venue => venue === 'handheld' ? '▣' : '🕹️'

export const setAgentHandheld = (world, agentId, details = null) => {
  if (typeof world?.setHandheld === 'function') {
    world.setHandheld(agentId, details)
    return
  }
  if (typeof world?.setAgentHandheld === 'function') {
    world.setAgentHandheld(agentId, details)
    return
  }
  const entity = world?.agent?.(agentId)
  if (!entity) return
  entity.meta ||= {}
  entity.meta.handheld = details ? { active: true, ...details } : null
  if (details) {
    entity.meta.activity = 'portable-play'
    entity.meta.playVenue = 'handheld'
  } else {
    delete entity.meta.activity
    delete entity.meta.playVenue
  }
}

export function routeAgentBounded(world, agentId, target, {
  kind = 'play-game', venue = 'handheld', gameId = null, title = null,
  timeoutMs = 7000, maxReplans = 1, allowDuringSim = false
} = {}) {
  const startedAt = Date.now()
  const routePlan = {
    id: `${agentId}:${kind}:${startedAt}`,
    kind,
    venue,
    target: [...target],
    steps: ['목적지 선택', '충돌 회피 경로 탐색', '도착 확인'],
    planner: 'bounded-astar-fallback',
    maxReplans,
    replans: 0,
    startedAt,
    status: 'routing',
    evidence: []
  }

  return new Promise(resolve => {
    let done = false
    let replanTimer = null
    let watchdog = null
    let plannerHandle = null

    const finish = reason => {
      if (done) return
      done = true
      clearTimeout(replanTimer)
      clearTimeout(watchdog)
      if (reason !== 'arrived') plannerHandle?.cancel?.()
      const plannerMeta = world?.agent?.(agentId)?.meta?.autonomyAssignment
      if (plannerMeta && (!routePlan.plannerGoalId || plannerMeta.id === routePlan.plannerGoalId)) {
        routePlan.plannerGoalId = plannerMeta.id || routePlan.plannerGoalId || null
        routePlan.route = Array.isArray(plannerMeta.routePlan) ? plannerMeta.routePlan : []
        routePlan.replans = Math.max(routePlan.replans, Number(plannerMeta.replans) || 0)
        routePlan.plannerStatus = plannerMeta.status || null
        const plannerEvidence = (plannerMeta.evidence || []).slice(-4).map(item => {
          if (typeof item === 'string') return item
          if (item?.type === 'assigned') return `목표 할당 · ${item.venue || venue} [${item.target?.join(',') || target.join(',')}]`
          if (item?.type === 'arrived') return `플래너 도착 확인 · ${item.activity || kind}`
          return item?.type ? `플래너 증거 · ${item.type}` : null
        }).filter(Boolean)
        routePlan.evidence.push(...plannerEvidence)
      }
      const distance = tileDistance(world?.agent?.(agentId), target)
      routePlan.endedAt = Date.now()
      routePlan.durationMs = routePlan.endedAt - startedAt
      routePlan.distanceAtEnd = Number.isFinite(distance) ? +distance.toFixed(2) : null
      routePlan.arrived = reason === 'arrived' || distance < 1.35
      routePlan.status = routePlan.arrived ? 'arrived' : 'timeout'
      routePlan.evidence.push(routePlan.arrived
        ? `목적지 ${target.join(',')} 도착 (${routePlan.durationMs}ms)`
        : `${timeoutMs}ms 경로 상한으로 중단`)
      resolve(routePlan)
    }

    const submit = () => {
      const goal = {
        kind, venue, target: [...target], gameId, title,
        maxDurationMs: timeoutMs,
        maxReplans,
        allowDuringSim,
        onArrive: () => finish('arrived')
      }
      try {
        if (typeof world?.enqueueNpcGoal === 'function') {
          routePlan.planner = 'autonomous-goal-planner'
          const accepted = world.enqueueNpcGoal(agentId, goal)
          plannerHandle = accepted || plannerHandle
          routePlan.plannerGoalId = accepted?.id || routePlan.plannerGoalId || null
          if (accepted?.promise?.then) {
            accepted.promise.then(result => {
              if (result?.status === 'arrived' || result?.arrived) finish('arrived')
            }).catch(error => routePlan.evidence.push(`planner 중단: ${error?.message || error}`))
          } else if (accepted?.then) accepted.then(() => finish('arrived')).catch(() => {})
        } else {
          world?.goTo?.(agentId, target, () => finish('arrived'))
        }
      } catch (error) {
        routePlan.evidence.push(`planner 오류: ${error?.message || error}`)
        world?.goTo?.(agentId, target, () => finish('arrived'))
      }
    }

    submit()
    replanTimer = setTimeout(() => {
      if (done || routePlan.replans >= maxReplans) return
      if (tileDistance(world?.agent?.(agentId), target) < 1.35) return finish('arrived')
      // The autonomous planner owns its own bounded replan budget. Only the
      // legacy A* fallback needs this one-shot resubmission.
      if (routePlan.planner === 'autonomous-goal-planner') return
      routePlan.replans += 1
      routePlan.evidence.push(`정체 감지 · 제한 재계획 ${routePlan.replans}/${maxReplans}`)
      submit()
    }, Math.min(2400, timeoutMs * .52))
    watchdog = setTimeout(() => finish('timeout'), timeoutMs)
  })
}

const randomItem = items => items[Math.floor(Math.random() * items.length)]

export function startOfficeHandheldAmbience(world, team, getState) {
  let stopped = false
  let timer = null
  let session = null

  const schedule = (min = 9000, spread = 9000) => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(tick, min + Math.random() * spread)
  }

  const endSession = ({ returnHome = true } = {}) => {
    if (!session) return
    const { member, token } = session
    const entity = world?.agent?.(member.id)
    if (entity?.meta?.portableSession === token) {
      setAgentHandheld(world, member.id, null)
      delete entity.meta.portableSession
      if (returnHome && entity.home?.desk && getState()?.map === 'office' && getState()?.meeting?.status !== 'running') {
        routeAgentBounded(world, member.id, entity.home.desk, {
          kind: 'return-to-desk', venue: 'office', timeoutMs: 6500, maxReplans: 1
        }).then(() => world?.sit?.(member.id, entity.home.desk, entity.home.face))
      }
    }
    session = null
  }

  const tick = async () => {
    if (stopped) return
    const state = getState?.()
    if (state?.map !== 'office' || state?.meeting?.status === 'running' || state?.arcade?.status === 'running') {
      endSession({ returnHome: false })
      return schedule(6500, 6500)
    }
    if (session) return schedule(4500, 4000)

    const candidates = team.filter(member => {
      const entity = world?.agent?.(member.id)
      return entity && !entity.meta?.chatting && !entity.meta?.handheld && !entity.meta?.speaking
    })
    const member = randomItem(candidates)
    if (!member) return schedule()

    const target = randomItem(PORTABLE_SPOTS.office)
    const token = `${member.id}:${Date.now()}`
    session = { member, token }
    const entity = world.agent(member.id)
    entity.sitting = false
    entity.meta.portableSession = token
    entity.meta.plan = { kind: 'play-game', venue: 'handheld', target, status: 'routing', maxReplans: 1 }
    world?.bubble?.(member.id, randomItem(['잠깐 한 판만…', '휴대 테스트 해볼게요', '손맛 체크 중 ▣']), 2200)

    const routePlan = await routeAgentBounded(world, member.id, target, {
      kind: 'play-game', venue: 'handheld', timeoutMs: 6500, maxReplans: 1
    })
    if (stopped || session?.token !== token) return
    entity.meta.plan = routePlan
    if (!routePlan.arrived) {
      endSession({ returnHome: true })
      return schedule(7000, 6000)
    }

    setAgentHandheld(world, member.id, {
      state: 'playing', title: '사내 최신 빌드', gameId: null, since: Date.now()
    })
    world?.face?.(member.id, 'down')
    world?.bubble?.(member.id, randomItem(['오, 이 콤보 괜찮다!', '한 판 더!', '여기 피드백 있네요']), 2600)
    setTimeout(() => {
      if (stopped || session?.token !== token) return
      endSession({ returnHome: true })
      schedule(11000, 11000)
    }, 9500 + Math.random() * 6500)
  }

  schedule(4500, 5000)
  return () => {
    stopped = true
    clearTimeout(timer)
    endSession({ returnHome: false })
  }
}
