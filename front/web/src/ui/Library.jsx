import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store.js'
import { api } from '../api.js'
import Markdown from './Markdown.jsx'
import Radar from './Radar.jsx'
import { CRITERIA, strongWeak } from '../data/criteria.js'

export default function Library({ onPlay, onUpgrade, onDeploy, portable = false }) {
  const games = useStore(s => s.games)
  const closePanel = useStore(s => s.closePanel)
  const toast = useStore(s => s.toast)
  const [sel, setSel] = useState(null)
  const [tab, setTab] = useState('info')
  const [files, setFiles] = useState(null)
  const [curFile, setCurFile] = useState('game.js')
  const [log, setLog] = useState(null)
  const [diff, setDiff] = useState(null)
  const [ref, setRef] = useState('HEAD')

  const game = games.find(g => g.id === sel)

  useEffect(() => {
    if (!game) return
    setTab('info'); setFiles(null); setLog(null); setDiff(null); setRef('HEAD'); setCurFile('game.js')
  }, [sel])

  useEffect(() => {
    if (!game) return
    if (tab === 'code') api.files(game.id, ref === 'HEAD' ? undefined : ref).then(r => setFiles(r.files)).catch(() => setFiles({}))
    if (tab === 'versions') api.gitlog(game.id).then(setLog).catch(() => setLog({ tags: [], commits: [] }))
  }, [tab, game?.id, ref])

  async function showDiff(from, to) {
    setDiff({ loading: true })
    const d = await api.diff(game.id, from, to).catch(e => ({ patch: '(diff 실패: ' + e.message + ')' }))
    setDiff({ from, to, ...d })
  }

  function share() {
    const url = `${location.origin}/play/${game.id}`
    navigator.clipboard?.writeText(url)
    toast(`🔗 공유 링크 복사됨: ${url}`, 'success')
  }

  if (!game) {
    return (
      <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
        <div className={`modal library-modal library-overview ${portable ? 'portable-library' : ''}`}>
          <div className="modal-head library-head"><div className="modal-title-block"><span className="modal-kicker">{portable ? 'DOTCADE POCKET · GAME SELECT' : 'MY RELEASES'}</span><b>{portable ? '▣ 휴대 플레이용 게임팩' : '🗄️ 게임팩 진열대'}</b></div><span className="library-count">{games.length}개 출시</span><button className="x" onClick={closePanel}>✕</button></div>
          {portable && <div className="portable-library-banner"><i />휴대기가 연결되었습니다 <b>게임팩을 선택하면 POCKET 모드로 바로 부팅합니다</b></div>}
          <div className="game-grid">
            {games.map(g => {
              const fb = g.feedback?.[g.version]
              const st = g.stats
              const sw = st?.ratings ? strongWeak(st.ratings) : null
              return (
                <div key={g.id} className="game-card" style={{ '--c': g.color }} onClick={() => setSel(g.id)}>
                  <div className="cart" style={{ background: g.color }}><span>{g.emoji}</span></div>
                  <b>{g.title}</b>
                  <div className="tiny muted">{g.version} · {g.genre}{g.source === 'meeting' ? ' · 회의 제작' : ''}</div>
                  {st?.ratings ? (
                    <>
                      <Radar ratings={st.ratings} size={100} color={g.color}
                        title={CRITERIA.map(c => `${c.label} ${st.ratings[c.key] ?? '-'}`).join(' · ')} />
                      <div className="tiny">⭐ <b>{st.avgScore ?? fb?.avg ?? '-'}</b>/10 · 시뮬 {st.runs}회 · {st.reports}명</div>
                      {sw && <div className="tiny sw-line"><b className="good">▲ {sw.top[0]} {sw.top[1]}</b> <b className="bad">▼ {sw.low[0]} {sw.low[1]}</b></div>}
                    </>
                  ) : (
                    fb?.avg != null
                      ? <div className="tiny">⭐ 오락실 평균 <b>{fb.avg}</b>/10</div>
                      : <div className="tiny muted radar-empty">오락실 평가 전</div>
                  )}
                </div>
              )
            })}
            {games.length === 0 && <div className="sys-line">아직 게임이 없습니다. 회의를 열어 첫 게임을 만들어보세요!</div>}
          </div>
        </div>
      </div>
    )
  }

  const fb = game.feedback?.[game.version]
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && closePanel()}>
      <div className={`modal big library-modal library-detail library-tab-${tab} ${portable ? 'portable-library' : ''}`}>
        <div className="modal-head library-head">
          <button className="back-button" onClick={() => setSel(null)} aria-label="게임 목록으로 돌아가기">←</button>
          <div className="library-title"><b>{game.emoji} {game.title}</b><span className="muted tiny">{game.desc}</span></div>
          {portable && <span className="portable-ready"><i />POCKET READY</span>}
          <span className="ver">{game.version}</span>
          <button className="x" onClick={closePanel}>✕</button>
        </div>
        <div className="tabs">
          {['info', 'code', 'versions', 'feedback'].map(t => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ info: '개요', code: '코드 (git)', versions: '버전 로그', feedback: '오락실 피드백' }[t]}
            </button>
          ))}
        </div>

        {tab === 'info' && (
          <div className="detail-body">
            <div className="actions">
              <button className="primary" onClick={() => onPlay(game.id)}>{portable ? '▣ POCKET에서 시작' : '▶ 플레이'}</button>
              <button className="accent" onClick={() => { closePanel(); onDeploy(game) }}>🕹️ 오락실 배포 & 20명 시뮬레이션</button>
              <button onClick={() => onUpgrade(game)}>🧠 업그레이드 회의</button>
              <button onClick={share}>🔗 공유 링크 복사</button>
            </div>
            <div className="info-grid">
              <div>장르 <b>{game.genre}</b></div>
              <div>조작 <b>{(game.controls || []).join(' ') || '-'}</b></div>
              <div>버전 <b>{game.version}</b> ({game.versions.length}개 릴리즈)</div>
              <div>제작 <b>{game.source === 'default' ? '기본 게임' : 'BMAD 회의'}</b></div>
              {fb?.avg != null && <div>오락실 평균 <b>⭐ {fb.avg}/10</b> ({fb.reports?.length}명)</div>}
            </div>
            {game.stats?.ratings && (() => {
              const sw = strongWeak(game.stats.ratings)
              return (
                <div className="info-radar">
                  <Radar ratings={game.stats.ratings} size={180} color={game.color} values />
                  <div className="report-radar-side">
                    <div className="tiny muted">누적 평가 — 시뮬레이션 <b>{game.stats.runs}회</b> · 손님 <b>{game.stats.reports}명</b>{game.stats.avgScore != null && <> · 종합 <b>⭐ {game.stats.avgScore}/10</b></>}</div>
                    <div className="axis-chips">
                      {CRITERIA.map(c => game.stats.ratings[c.key] != null && (
                        <span key={c.key} className="axis-chip" title={c.desc}>{c.label} <b>{game.stats.ratings[c.key]}</b></span>
                      ))}
                    </div>
                    {sw && <div className="sw-line">강점 <b className="good">▲ {sw.top[0]} {sw.top[1]}</b> · 약점 <b className="bad">▼ {sw.low[0]} {sw.low[1]}</b></div>}
                  </div>
                </div>
              )
            })()}
            <div className="tiny muted">공유: 같은 네트워크의 누구나 <code>{location.origin}/play/{game.id}</code> 에서 바로 플레이할 수 있습니다.</div>
          </div>
        )}

        {tab === 'code' && (
          <div className="code-view">
            <div className="file-tree">
              <select value={ref} onChange={e => setRef(e.target.value)}>
                <option value="HEAD">HEAD (최신)</option>
                {game.versions.slice().reverse().map(v => <option key={v.v} value={v.v}>{v.v}</option>)}
              </select>
              {files && Object.keys(files).sort().map(f => (
                <div key={f} className={`file ${curFile === f ? 'on' : ''}`} onClick={() => setCurFile(f)}>
                  {f.endsWith('.js') ? '📜' : f.endsWith('.json') ? '🔧' : '📄'} {f}
                </div>
              ))}
            </div>
            <pre className="code">{files ? (files[curFile] ?? '(파일 선택)') : '불러오는 중...'}</pre>
          </div>
        )}

        {tab === 'versions' && (
          <div className="detail-body">
            {!log ? '불러오는 중...' : (
              <>
                <div className="vlog">
                  {log.tags.slice().reverse().map((t, i, arr) => {
                    const prev = arr[i + 1]
                    return (
                      <div key={t.v} className="vrow">
                        <b className="ver">{t.v}</b>
                        <span className="tiny muted">{t.date?.slice(0, 16)}</span>
                        <span style={{ flex: 1 }}>{t.message}</span>
                        <button onClick={() => onPlay(game.id, t.v)}>{portable ? '▣' : '▶'}</button>
                        {prev && <button onClick={() => showDiff(prev.v, t.v)}>diff</button>}
                      </div>
                    )
                  })}
                </div>
                {diff && (
                  <div className="diff-box">
                    <div className="tiny"><b>git diff {diff.from}..{diff.to}</b></div>
                    <pre className="code diff">{diff.loading ? '...' : (diff.stat || '') + '\n' + (diff.patch || '')}</pre>
                  </div>
                )}
                <div className="tiny muted">각 버전은 서버의 실제 git 레포에 커밋·태그로 저장됩니다 (server/data/games/{game.id}).</div>
              </>
            )}
          </div>
        )}

        {tab === 'feedback' && (
          <div className="detail-body">
            {Object.keys(game.feedback || {}).length === 0 && <div className="sys-line">아직 피드백이 없습니다. 오락실에 배포해 20명의 반응을 받아보세요!</div>}
            {Object.entries(game.feedback || {}).sort((a, b) => b[0].localeCompare(a[0])).map(([v, f]) => (
              <div key={v} className="fb-version">
                <div className="fb-head"><b className="ver">{v}</b> 평균 <b>⭐ {f.avg}/10</b> · {f.reports?.length}명 · {f.at?.slice(0, 10)}</div>
                <div className="fb-flex">
                  {f.ratings && (
                    <div className="fb-radar">
                      <Radar ratings={f.ratings} compare={game.stats?.runs > 1 ? game.stats.ratings : null} size={132} color={game.color} compareColor="#7dc7ff" />
                      <div className="tiny muted" style={{ textAlign: 'center' }}>이 시뮬{game.stats?.runs > 1 ? ' vs 누적(점선)' : ''}</div>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {f.summary && <Markdown className="md" text={f.summary} />}
                  </div>
                </div>
                <div className="fb-chips">
                  {(f.reports || []).map((r, i) => (
                    <span key={i} className="chip" title={`${r.detail?.fun || ''}\n${r.detail?.difficulty || ''}`}>
                      {r.visitor?.name} {r.score}점 — {r.oneLiner}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
