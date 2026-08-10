import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig(({ mode }) => {
  // 레포 루트의 단일 .env 사용 — FRONT_PORT, FRONT_BACK_ORIGIN
  const env = loadEnv(mode, REPO_ROOT, ['FRONT_'])
  const backOrigin = env.FRONT_BACK_ORIGIN || 'http://localhost:5175'
  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      port: Number(env.FRONT_PORT || 5173),
      proxy: {
        '/api': backOrigin,
        '/play': backOrigin
      }
    }
  }
})
