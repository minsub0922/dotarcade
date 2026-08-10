# DOTCADE 배포 가이드

## 구성 요약

| 구성 | 위치 | 배포처 |
|------|------|--------|
| 프론트 (Vite + React SPA) | `front/` | **Vercel** — 정적 빌드 + `/api`·`/play` 리라이트 프록시 |
| 백엔드 (Express) | `back/` | **상시 실행 호스트** (Render / Fly.io / Railway 등) |

백엔드는 Vercel 서버리스에 올릴 수 없다. 이유:

- `back/server/lib/repos.js`가 실제 `git` 바이너리를 `execFile`로 실행한다 — Vercel 함수 런타임에는 git이 없다.
- 브라우저별 프로필 DB(`data/profiles/<id>`)와 게임 레포를 로컬 디스크에 영구 저장한다 — 서버리스 파일시스템은 휘발성이라 요청마다 상태가 사라진다.

전부 Vercel로 옮기려면 상태 저장을 Vercel Blob/KV 등으로 리팩터링해야 하며, 이는 단순 셋업 범위를 넘는다.

## 1. 프론트 — Vercel

`front/vercel.json`이 이미 준비돼 있다 (Vite 빌드, `web/dist` 출력, SPA 폴백, 백엔드 프록시).

### 최초 셋업 (1회)

```bash
vercel login                       # 브라우저 인증
cd front
vercel link                        # 새 프로젝트 생성 (예: dotarcade)
vercel git connect                 # GitHub 레포 연결 → push 시 자동 배포
```

또는 대시보드에서 Import: **Root Directory를 `front`로 지정**하는 것이 핵심. 나머지(framework, output)는 `vercel.json`이 알아서 처리한다.

### 백엔드 주소 연결

백엔드를 배포한 뒤 `front/vercel.json`의 `REPLACE-WITH-BACKEND-ORIGIN` 두 곳을 실제 백엔드 origin(예: `dotarcade-back.onrender.com`)으로 바꾸고 커밋한다.
리라이트는 Vercel이 서버사이드로 프록시하므로 브라우저 입장에선 same-origin — 백엔드의 프로필 쿠키·SSE 스트리밍이 그대로 동작한다.

### 배포

- Git 연결 후: `main` push → 프로덕션, 다른 브랜치 push → 프리뷰 자동 배포
- 수동: `cd front && vercel` (프리뷰) / `vercel --prod` (프로덕션)

## 2. 백엔드 — 상시 실행 호스트

요구 사항: Node 20+, `git` 바이너리, 영구(또는 최소한 재시작 전까지 유지되는) 디스크.

- **시작 명령**: `cd back && npm install && npm start` (`node server/index.js`, 포트 `BACK_PORT` 기본 5175)
- **환경변수**: 루트 `.env`의 `BACK_*` 키를 호스트 환경변수로 등록 — `BACK_GEMINI_API_KEY`, `BACK_TAVILY_API_KEYS`, `BACK_PORT` 등 (코드가 `process.env` 우선이라 `.env` 파일 없이도 동작)
- Render/Railway는 저장소 루트가 레포 루트이므로 **Root Directory를 `back`으로** 지정

## 3. 로컬 개발 (변경 없음)

```bash
cd back && npm run dev     # :5175
cd front && npm run dev    # :5173, /api·/play → :5175 프록시
```
