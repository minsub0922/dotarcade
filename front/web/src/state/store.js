// DOTCADE — zustand 전역 상태
import { create } from 'zustand'

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

  // 상호작용 힌트 (E키 대상)
  hint: null,
  setHint: hint => {
    if (JSON.stringify(hint) !== JSON.stringify(get().hint)) set({ hint })
  },

  // 회의
  meeting: null, // {id, agenda, phase, phaseLabel, transcript:[], artifacts:{}, status, gameId?, approval?}
  setMeeting: patch => set(s => ({ meeting: patch === null ? null : { ...(s.meeting || {}), ...patch } })),
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

  // 설정
  settings: JSON.parse(localStorage.getItem('dotcade-settings') || '{"autoApprove":true,"simConcurrency":3}'),
  setSettings: patch => {
    const settings = { ...get().settings, ...patch }
    localStorage.setItem('dotcade-settings', JSON.stringify(settings))
    set({ settings })
  }
}))
