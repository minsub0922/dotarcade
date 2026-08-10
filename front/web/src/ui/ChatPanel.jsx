import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store.js'
import { api } from '../api.js'
import { TEAM } from '../data/personas.js'
import { chatWithAgent } from '../meeting/engine.js'
import Markdown from './Markdown.jsx'

export default function ChatPanel({ world }) {
  const { panelData, closePanel } = useStore()
  const member = TEAM.find(t => t.id === panelData?.agentId)
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const feedRef = useRef(null)

  useEffect(() => {
    if (!member) return
    api.chatHistory(member.id).then(r => setHistory(r.history || []))
    return () => {
      const e = world?.agent(member.id)
      if (e) e.meta.chatting = false
    }
  }, [member?.id])

  useEffect(() => {
    feedRef.current?.scrollTo(0, 1e9)
  }, [history, streaming])

  if (!member) return null

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const userMsg = { role: 'user', text, ts: Date.now() }
    setHistory(h => [...h, userMsg])
    setBusy(true); setStreaming('')
    try {
      // 스트리밍 표시를 위해 chatWithAgent 대신 직접 스트림
      const reply = await streamReply(text)
      const aiMsg = { role: 'model', text: reply, ts: Date.now() }
      setHistory(h => [...h, aiMsg])
      api.chatAppend(member.id, [userMsg, aiMsg])
    } catch (e) {
      setHistory(h => [...h, { role: 'model', text: `(응답 실패: ${e.message})`, ts: Date.now() }])
    }
    setBusy(false); setStreaming('')
  }

  async function streamReply(text) {
    const { chatSystem } = await import('../meeting/prompts.js')
    const games = useStore.getState().games
    const recent = games.slice(-3).map(g => `${g.title} ${g.version}`).join(', ')
    world?.emote(member.id, true)
    try {
      const out = await api.stream(
        {
          system: chatSystem(member, games, recent),
          messages: [...history.slice(-12).map(h => ({ role: h.role, text: h.text })), { role: 'user', text }],
          hint: 'chat', model: 'fast', personaMeta: { name: member.name }
        },
        (d, full) => { setStreaming(full); world?.bubble(member.id, full.slice(-52), 4000) }
      )
      world?.bubble(member.id, out.text.slice(0, 60), 5000)
      return out.text
    } finally { world?.emote(member.id, false) }
  }

  return (
    <aside className="panel side">
      <div className="panel-head" style={{ borderColor: member.color }}>
        <img src={`/assets/sprites/${member.sprite}/face.png`} alt="" className="face" />
        <div>
          <b>{member.name}</b> <span className="muted">{member.title}</span>
          <div className="tiny muted">{member.bmad}</div>
        </div>
        <button className="x" onClick={closePanel}>✕</button>
      </div>
      <div className="feed" ref={feedRef}>
        {history.length === 0 && <div className="sys-line">가까이에서 <b>E</b>를 눌러 언제든 대화할 수 있습니다. 인사를 건네보세요!</div>}
        {history.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}>
            {m.role !== 'user' && <img src={`/assets/sprites/${member.sprite}/face.png`} className="face sm" alt="" />}
            <div className="bubble-ui"><Markdown text={m.text} /></div>
          </div>
        ))}
        {streaming && (
          <div className="msg ai">
            <img src={`/assets/sprites/${member.sprite}/face.png`} className="face sm" alt="" />
            <div className="bubble-ui"><Markdown text={streaming} /><span className="caret">▌</span></div>
          </div>
        )}
      </div>
      <div className="input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`${member.name}에게 말하기...`}
          autoFocus
        />
        <button onClick={send} disabled={busy}>{busy ? '…' : '전송'}</button>
      </div>
    </aside>
  )
}
