import React from 'react'
import { useStore } from '../state/store.js'
import { api } from '../api.js'

export default function Settings() {
  const { config, setConfig, settings, setSettings, closePanel, toast } = useStore()

  async function redetect() {
    const st = await api.redetect().catch(() => null)
    if (st) {
      const cfg = await api.config()
      setConfig(cfg)
      toast(`LLM 모드: ${cfg.llm}${cfg.llmError ? ` (${cfg.llmError})` : ''}`)
    }
  }

  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className="modal settings-modal">
        <div className="modal-head"><b>⚙️ 설정</b><button className="x" onClick={closePanel}>✕</button></div>
        <div className="detail-body">
          <div className="field">
            <label>LLM 상태</label>
            <div className="sys-line settings-status">
              모드: <b className={config.llm}>{config.llm === 'live' ? '⚡ Gemini 연결됨' : '🧪 모의(mock) 모드'}</b>
              {config.llmError && <div className="tiny err">{config.llmError}</div>}
              <div className="tiny muted">smart: {config.models?.smart} · fast: {config.models?.fast}</div>
              <div className="tiny muted">API 키와 모델은 프로젝트 루트의 <code>.env</code> 파일에서 관리합니다. 수정 후 서버를 재시작하세요.</div>
              <button className="settings-reconnect" onClick={redetect}>연결 다시 감지</button>
            </div>
          </div>
          <div className="field">
            <label>회의 자동 진행 (승인 게이트 자동 통과)</label>
            <button className={`settings-toggle ${settings.autoApprove ? 'primary on' : ''}`} onClick={() => setSettings({ autoApprove: !settings.autoApprove })}>
              {settings.autoApprove ? 'ON — 자동 승인 (6초 대기)' : 'OFF — 직접 승인 필요'}
            </button>
          </div>
          <div className="field range-field">
            <label>오락실 동시 시뮬레이션 수: {settings.simConcurrency}</label>
            <input type="range" min="1" max="6" value={settings.simConcurrency}
              onChange={e => setSettings({ simConcurrency: +e.target.value })} />
            <div className="tiny muted">무료 Gemini 키는 분당 요청 제한이 있어 3 이하를 권장합니다. 서버 .env의 MAX_LLM_CONCURRENCY도 함께 조절됩니다.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
