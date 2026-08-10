// DOTCADE — 게임팩당 실제 git 레포 관리 (init/commit/tag/show/diff) — 프로필별 games 디렉터리
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const sane = id => {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(id)) throw new Error('잘못된 게임 id: ' + id)
  return id
}

function git(cwd, ...args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout))
  })
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (rel.includes('..')) continue
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content ?? '')
  }
}

export function makeRepos(gamesDir) {
  fs.mkdirSync(gamesDir, { recursive: true })
  const dir = id => path.join(gamesDir, sane(id))

  return {
    exists: id => fs.existsSync(path.join(dir(id), '.git')),

    async create(id, files, message, version = 'v1.0.0') {
      const d = dir(id)
      fs.mkdirSync(d, { recursive: true })
      writeFiles(d, files)
      await git(d, 'init', '-q', '-b', 'main')
      await git(d, 'config', 'user.email', 'bot@dotcade.local')
      await git(d, 'config', 'user.name', 'DOTCADE Bot')
      await git(d, 'add', '-A')
      await git(d, 'commit', '-q', '-m', message || `release ${version}`)
      await git(d, 'tag', version)
      return version
    },

    async addVersion(id, files, message, version) {
      const d = dir(id)
      writeFiles(d, files)
      await git(d, 'add', '-A')
      await git(d, 'commit', '-q', '-m', message || `release ${version}`)
      await git(d, 'tag', version)
      return version
    },

    async versions(id) {
      const d = dir(id)
      const out = await git(d, 'for-each-ref', 'refs/tags', '--sort=creatordate',
        '--format=%(refname:short)%09%(creatordate:iso8601)%09%(subject)')
      return out.trim().split('\n').filter(Boolean).map(l => {
        const [v, date, ...m] = l.split('\t')
        return { v, date, message: m.join('\t') }
      })
    },

    async log(id) {
      const d = dir(id)
      const out = await git(d, 'log', '--format=%h%x09%ad%x09%s', '--date=short')
      return out.trim().split('\n').filter(Boolean).map(l => {
        const [hash, date, ...m] = l.split('\t')
        return { hash, date, message: m.join('\t') }
      })
    },

    async filesAt(id, ref = 'HEAD') {
      const d = dir(id)
      const list = (await git(d, 'ls-tree', '-r', '--name-only', ref)).trim().split('\n').filter(Boolean)
      const files = {}
      for (const f of list) {
        files[f] = await git(d, 'show', `${ref}:${f}`)
      }
      return files
    },

    async fileAt(id, ref, file) {
      return git(dir(id), 'show', `${ref}:${file}`)
    },

    async diff(id, from, to) {
      const d = dir(id)
      const stat = await git(d, 'diff', '--stat', `${from}..${to}`)
      const patch = await git(d, 'diff', `${from}..${to}`)
      return { stat, patch: patch.slice(0, 200000) }
    },

    latestCode(id) {
      const p = path.join(dir(id), 'game.js')
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    }
  }
}
