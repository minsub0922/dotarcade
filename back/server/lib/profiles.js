// DOTCADE — 브라우저(쿠키)별 독립 프로필 DB
// data/seed        : 모든 프로필의 초기 상태 스냅샷 (db.json + vectors.json + games/*)
// data/profiles/<p>: 브라우저별 복제본 — 히스토리·게임·RAG 전부 독립
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DB, DATA_DIR } from './db.js'
import { makeRepos } from './repos.js'
import { makeRag } from './rag.js'
import { ensureDefaults } from './seed.js'

const SEED_DIR = path.join(DATA_DIR, 'seed')
const PROFILES_DIR = path.join(DATA_DIR, 'profiles')
export const COOKIE = 'dotcade_uid'

const cache = new Map()
let _seedCtx = null

function ctxFor(base, id) {
  return {
    id,
    base,
    db: new DB(path.join(base, 'db.json')),
    repos: makeRepos(path.join(base, 'games')),
    rag: makeRag(path.join(base, 'vectors.json'))
  }
}

// 최초 1회: 기존 data/{db.json,vectors.json,games}를 seed 스냅샷으로 승격
export function ensureSeed() {
  if (!fs.existsSync(path.join(SEED_DIR, 'db.json'))) {
    fs.mkdirSync(SEED_DIR, { recursive: true })
    const legacyDb = path.join(DATA_DIR, 'db.json')
    const legacyVec = path.join(DATA_DIR, 'vectors.json')
    const legacyGames = path.join(DATA_DIR, 'games')
    if (fs.existsSync(legacyDb)) fs.copyFileSync(legacyDb, path.join(SEED_DIR, 'db.json'))
    if (fs.existsSync(legacyVec)) fs.copyFileSync(legacyVec, path.join(SEED_DIR, 'vectors.json'))
    if (fs.existsSync(legacyGames)) fs.cpSync(legacyGames, path.join(SEED_DIR, 'games'), { recursive: true })
    console.log('   프로필 시드 스냅샷 생성: data/seed (현재 상태를 모든 브라우저의 초기 상태로 사용)')
  }
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
}

export function seedCtx() {
  if (!_seedCtx) _seedCtx = ctxFor(SEED_DIR, 'seed')
  return _seedCtx
}

async function buildProfile(pid) {
  const base = path.join(PROFILES_DIR, pid)
  if (!fs.existsSync(base)) {
    _seedCtx?.db.flush() // 시드에 쓰기 지연이 남아있으면 반영 후 복제
    fs.cpSync(SEED_DIR, base, { recursive: true })
    console.log(`   새 브라우저 프로필 생성: ${pid} (seed 복제)`)
  }
  const ctx = ctxFor(base, pid)
  // 기본 게임 3종(픽셀 러너·메테오 닷지·스네이크 클래식)은 어떤 프로필에도 항상 존재하도록 보장
  const healed = await ensureDefaults(ctx).catch(e => { console.error('기본 게임 복구 실패:', e.message); return 0 })
  if (healed) console.log(`   프로필 ${pid}: 기본 게임 ${healed}종 복구`)
  return ctx
}

// 같은 프로필의 동시 첫 요청이 중복 초기화하지 않도록 promise를 캐시
export function getProfile(pid) {
  if (!cache.has(pid)) {
    cache.set(pid, buildProfile(pid).catch(e => { cache.delete(pid); throw e }))
  }
  return cache.get(pid)
}

const parseCookies = req => Object.fromEntries(
  (req.headers.cookie || '').split(';').map(s => {
    const i = s.indexOf('=')
    return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), decodeURIComponent(s.slice(i + 1).trim())]
  }).filter(([k]) => k)
)

// /api·/play 요청마다 쿠키로 프로필 식별 (없으면 발급 + seed 복제)
export async function profileMiddleware(req, res, next) {
  let pid = parseCookies(req)[COOKIE]
  if (!pid || !/^p[a-f0-9]{8,64}$/.test(pid)) {
    pid = 'p' + crypto.randomBytes(8).toString('hex')
    res.setHeader('Set-Cookie', `${COOKIE}=${pid}; Path=/; Max-Age=31536000; SameSite=Lax`)
  }
  try {
    req.p = await getProfile(pid)
    next()
  } catch (e) {
    res.status(500).json({ error: '프로필 초기화 실패: ' + String(e.message || e) })
  }
}
