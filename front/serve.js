// DOTCADE 프론트 배포 서버 — web/dist 정적 서빙 + /api·/play → 백엔드 프록시
// 외부 의존성 없음(Node 내장 모듈만 사용). 포트: FRONT_PORT(기본 5173), 백엔드: BACK_ORIGIN(기본 http://localhost:5175)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'web', 'dist')
const PORT = Number(process.env.FRONT_PORT || 5173)
const BACK = new URL(process.env.BACK_ORIGIN || 'http://localhost:5175')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8'
}

function proxy(req, res) {
  const opt = {
    hostname: BACK.hostname, port: BACK.port, path: req.url, method: req.method,
    headers: { ...req.headers, host: BACK.host }
  }
  const up = http.request(opt, r => {
    res.writeHead(r.statusCode || 502, r.headers)
    r.pipe(res) // SSE 스트리밍 포함 그대로 통과
  })
  up.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '백엔드(:' + BACK.port + ') 연결 실패 — dotcade-back이 떠 있는지 확인하세요. ' + e.message }))
  })
  req.pipe(up)
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname.startsWith('/api') || u.pathname.startsWith('/play')) return proxy(req, res)
  let p = path.normalize(path.join(DIST, decodeURIComponent(u.pathname)))
  if (!p.startsWith(DIST)) { res.writeHead(403); return res.end('forbidden') }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html') // SPA 폴백
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(p).pipe(res)
})

server.listen(PORT, () => {
  console.log(`\n🕹  DOTCADE front  http://localhost:${PORT}   (API 프록시 → ${BACK.origin})`)
})
