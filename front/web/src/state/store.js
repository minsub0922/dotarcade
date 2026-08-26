// DOTCADE — zustand 전역 상태
import { create } from 'zustand'

const STUDIO_KEY = 'dotcade-studio-progress'
const DEFAULT_STUDIO = {
  level: 1,
  totalXp: 0,
  coins: 0,
  releaseStreak: 0,
  releases: 0,
  activeMission: null,
  lastReward: null,
  releaseRewards: {}
}

const readLocal = (key, fallback) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null')
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback
  } catch { return fallback }
}

const saveStudio = studio => {
  try { localStorage.setItem(STUDIO_KEY, JSON.stringify(studio)) } catch { /* storage unavailable */ }
}

export const useStore = create((set, get) => ({
  // 서버/LLM
  config: { llm: 'unknown', models: {} },
  setConfig: config => set({ config }),

  // 게임 목록
  games: [],
  setGames: games => set({ games }),

  // 맵
  map: 'office',
  setMap: map => set({ map }),

  // UI 패널: null | chat | library | gameDetail | play | meeting | arcade | settings | help
  panel: null,
  panelData: null,
  openPanel: (panel, panelData = null) => set({ panel, panelData }),
  closePanel: () => set({ panel: null, panelData: null }),

  // 상호작용 힌트 (E 기본 동작 + 겹치지 않는 R 탈것 보조 동작)
  hint: null,
  setHint: hint => {
    if (JSON.stringify(hint) !== JSON.stringify(get().hint)) set({ hint })
  },

  // 회의
  meeting: null, // {id, agenda, phase, transcript:[], research, directionGate?, direction?, artifacts, status, reward?}
  setMeeting: patch => set(s => ({ meeting: patch === null ? null : { ...(s.meeting || {}), ...patch } })),
  replaceMeeting: meeting => set({ meeting }),
  pushTranscript: entry => set(s => {
    if (!s.meeting) return {}
    const t = [...s.meeting.transcript]
    const last = t[t.length - 1]
    if (entry.append && last && last.agentId === entry.agentId && last.kind === entry.kind) {
      t[t.length - 1] = { ...last, text: last.text + entry.text }
    } else {
      t.push({ ts: Date.now(), ...entry })
    }
    return { meeting: { ...s.meeting, transcript: t } }
  }),

  // 오락실 시뮬레이션
  arcade: null, // {gameId, version, status, startedAt, reports:[], progress, summary, liveSims:[]}
  setArcade: patch => set(s => ({ arcade: patch === null ? null : { ...(s.arcade || {}), ...patch } })),
  pushReport: report => set(s => s.arcade ? ({
    arcade: { ...s.arcade, reports: [...s.arcade.reports, report] }
  }) : {}),

  // 토스트
  toasts: [],
  toast: (text, type = 'info') => {
    const id = Date.now() + Math.random()
    set(s => ({ toasts: [...s.toasts, { id, text, type }] }))
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4200)
  },

  // 스튜디오 성장: 출시 결과를 간단한 메타 보상으로 연결
  studio: readLocal(STUDIO_KEY, DEFAULT_STUDIO),
  // 오락실 시뮬레이션 등 다른 시스템에서도 같은 통로로 보상할 수 있다.
  // missionId를 넘기면 해당 미션은 한 번만 정산된다.
  awardStudio: ({ xp = 0, coins = 0, reason = '', success = true, missionId = null }) => {
    const prev = get().studio || DEFAULT_STUDIO
    if (missionId && prev.activeMission?.id === missionId && prev.activeMission.status !== 'active') return null
    const gainedXp = Math.max(0, Math.round(Number(xp) || 0))
    const gainedCoins = Math.max(0, Math.round(Number(coins) || 0))
    const totalXp = (prev.totalXp || 0) + gainedXp
    const oldLevel = prev.level || 1
    const level = Math.floor(totalXp / 250) + 1
    const reward = {
      xp: gainedXp, coins: gainedCoins, reason, success: !!success,
      levelUp: level > oldLevel ? level : null,
      at: Date.now()
    }
    const activeMission = missionId && prev.activeMission?.id === missionId
      ? { ...prev.activeMission, status: success ? 'complete' : 'failed', completedAt: Date.now() }
      : prev.activeMission
    const studio = {
      ...prev,
      level,
      totalXp,
      coins: (prev.coins || 0) + gainedCoins,
      activeMission,
      lastReward: reward
    }
    saveStudio(studio)
    set({ studio })
    return reward
  },
  awardRelease: ({ releaseId = null, title, version, gameId, qaOk, upgrade = false, directionId = '', mission = null }) => {
    const prev = get().studio || DEFAULT_STUDIO
    // A resumed release may retry this local effect after the server already
    // committed the game. Keep rewards exactly-once by durable meeting id.
    if (releaseId && prev.releaseRewards?.[releaseId]) return prev.releaseRewards[releaseId]
    const nextStreak = qaOk ? (prev.releaseStreak || 0) + 1 : 0
    // 출시 자체는 작은 보상. 큰 보상은 activeMission을 평가하는 오락실 결과에서 지급한다.
    const xp = 20 + (qaOk ? 10 : 0) + (upgrade ? 5 : 0) + (directionId ? 5 : 0)
    const coins = 6 + (qaOk ? 4 : 0)
    const totalXp = (prev.totalXp || 0) + xp
    const oldLevel = prev.level || 1
    const level = Math.floor(totalXp / 250) + 1
    const activeMission = mission ? {
      ...mission,
      id: mission.id || `${gameId}:${version}:${directionId || 'build'}`,
      gameId,
      version,
      status: 'active',
      startedAt: Date.now()
    } : prev.activeMission
    const reward = {
      title, version, xp, coins, streak: nextStreak,
      qaOk: !!qaOk, reason: qaOk ? '안정 릴리스' : '불안정 릴리스', success: !!qaOk,
      levelUp: level > oldLevel ? level : null,
      at: Date.now()
    }
    const studio = {
      ...prev,
      level,
      totalXp,
      coins: (prev.coins || 0) + coins,
      releaseStreak: nextStreak,
      releases: (prev.releases || 0) + 1,
      activeMission,
      lastReward: reward,
      releaseRewards: releaseId
        ? { ...(prev.releaseRewards || {}), [releaseId]: reward }
        : (prev.releaseRewards || {})
    }
    saveStudio(studio)
    set({ studio })
    return reward
  },

  // 설정
  settings: readLocal('dotcade-settings', { autoApprove: true, simConcurrency: 3 }),
  setSettings: patch => {
    const settings = { ...get().settings, ...patch }
    localStorage.setItem('dotcade-settings', JSON.stringify(settings))
    set({ settings })
  }
}))
