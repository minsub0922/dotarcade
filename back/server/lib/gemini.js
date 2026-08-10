// DOTCADE — Gemini proxy provider (모델 폴백 + 백오프 + 동시성 세마포어 + mock 전환)
import { mockProvider } from './mock.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY = () => process.env.BACK_GEMINI_API_KEY || ''

const FALLBACKS = [
  'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-2.5-flash', 'gemini-flash-latest'
]
const EMBED_FALLBACKS = ['gemini-embedding-2', 'gemini-embedding-001', 'text-embedding-004']

export const models = {
  smart: () => process.env.BACK_GEMINI_MODEL_SMART || 'gemini-3.6-flash',
  fast: () => process.env.BACK_GEMINI_MODEL_FAST || 'gemini-3.5-flash-lite',
  embed: () => process.env.BACK_GEMINI_MODEL_EMBED || 'gemini-embedding-2'
}

// ---------- semaphore ----------
const MAX = () => Math.max(1, parseInt(process.env.BACK_MAX_LLM_CONCURRENCY || '4', 10))
let running = 0; const queue = []
async function withSlot(fn) {
  if (running >= MAX()) await new Promise(r => queue.push(r))
  running++
  try { return await fn() } finally { running--; const n = queue.shift(); if (n) n() }
}

// ---------- state ----------
export const llmState = { mode: 'unknown', lastError: null, workingModel: null }

export async function detectLLM() {
  const forced = (process.env.BACK_LLM_MODE || 'auto').toLowerCase()
  if (forced === 'mock') { llmState.mode = 'mock'; return llmState }
  if (!KEY()) { llmState.mode = 'mock'; llmState.lastError = 'BACK_GEMINI_API_KEY 없음'; return llmState }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000)
    const r = await fetch(`${BASE}/models?key=${KEY()}&pageSize=1`, { signal: ctl.signal })
    clearTimeout(t)
    if (r.ok) { llmState.mode = 'live'; llmState.lastError = null }
    else { llmState.mode = forced === 'live' ? 'live' : 'mock'; llmState.lastError = `Gemini HTTP ${r.status}` }
  } catch (e) {
    llmState.mode = forced === 'live' ? 'live' : 'mock'
    llmState.lastError = '네트워크에서 Gemini에 도달할 수 없음 (' + (e.cause?.code || e.message) + ')'
  }
  return llmState
}

function buildPayload({ system, messages = [], json, search, maxTokens }) {
  const contents = messages.map(m => ({
    role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.text ?? '') }]
  }))
  const payload = { contents }
  if (system) payload.system_instruction = { parts: [{ text: String(system) }] }
  if (search) payload.tools = [{ google_search: {} }]
  const gen = {}
  if (json && !search) {
    gen.responseMimeType = 'application/json'
    if (typeof json === 'object') gen.responseSchema = json
  }
  if (maxTokens) gen.maxOutputTokens = maxTokens
  if (Object.keys(gen).length) payload.generationConfig = gen
  return payload
}

function extractText(data) {
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('')
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .map(c => c.web && { title: c.web.title, uri: c.web.uri }).filter(Boolean).slice(0, 6)
  return { text, sources }
}

async function callOnce(model, payload, streamHandler) {
  const url = streamHandler
    ? `${BASE}/models/${model}:streamGenerateContent?alt=sse&key=${KEY()}`
    : `${BASE}/models/${model}:generateContent?key=${KEY()}`
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 180000)
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctl.signal
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      const err = new Error(`Gemini ${r.status}: ${body.slice(0, 300)}`)
      err.status = r.status
      throw err
    }
    if (!streamHandler) return extractText(await r.json())
    // SSE parse
    const reader = r.body.getReader(); const dec = new TextDecoder()
    let buf = '', full = '', sources = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const js = line.slice(5).trim()
        if (!js || js === '[DONE]') continue
        try {
          const data = JSON.parse(js)
          const { text, sources: s } = extractText(data)
          if (text) { full += text; streamHandler(text) }
          if (s.length) sources = s
        } catch { /* partial */ }
      }
    }
    return { text: full, sources }
  } finally { clearTimeout(t) }
}

async function callWithFallback(reqModel, payload, streamHandler) {
  const chain = [reqModel, llmState.workingModel, ...FALLBACKS].filter((m, i, a) => m && a.indexOf(m) === i)
  let lastErr
  for (const model of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await callOnce(model, payload, streamHandler)
        llmState.workingModel = model
        return { ...out, model }
      } catch (e) {
        lastErr = e
        if (e.status === 404 || e.status === 400) break            // 모델 문제 → 다음 모델
        if (e.status === 429 || e.status === 503 || e.status === 500 || e.name === 'AbortError') {
          await new Promise(r => setTimeout(r, 900 * (attempt + 1) + Math.random() * 600))
          continue                                                  // 재시도
        }
        break
      }
    }
  }
  throw lastErr || new Error('Gemini 호출 실패')
}

const liveProvider = {
  name: 'live',
  generate(opts) {
    const model = opts.model === 'smart' ? models.smart() : opts.model === 'fast' || !opts.model ? models.fast() : opts.model
    return withSlot(() => callWithFallback(model, buildPayload(opts)))
  },
  stream(opts, onDelta) {
    const model = opts.model === 'smart' ? models.smart() : opts.model === 'fast' || !opts.model ? models.fast() : opts.model
    return withSlot(() => callWithFallback(model, buildPayload(opts), onDelta))
  },
  async embed(texts) {
    return withSlot(async () => {
      let lastErr
      for (const model of [models.embed(), ...EMBED_FALLBACKS].filter((m, i, a) => a.indexOf(m) === i)) {
        try {
          const r = await fetch(`${BASE}/models/${model}:batchEmbedContents?key=${KEY()}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: String(t).slice(0, 8000) }] } }))
            })
          })
          if (!r.ok) { lastErr = new Error(`embed ${r.status}`); continue }
          const data = await r.json()
          return (data.embeddings || []).map(e => e.values)
        } catch (e) { lastErr = e }
      }
      throw lastErr
    })
  }
}

export function provider() {
  return llmState.mode === 'live' ? liveProvider : mockProvider
}
