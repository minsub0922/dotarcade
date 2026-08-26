# DOTCADE 배포 가이드

## 현재 배포 상태 (2026-08-26)

| 구성 | 위치 | 배포처 | URL |
|------|------|--------|-----|
| 프론트 (Vite + React SPA) | `front/` | **Vercel** (프로젝트 `dotarcade`) | https://dotarcade-dun.vercel.app |
| 백엔드 (Express, Docker) | `back/` | **Railway** (프로젝트 `dotarcade-back`) | https://dotarcade-back-production.up.railway.app |

- Vercel은 GitHub 연동 완료 — `main` push 시 프론트 자동 배포
- Railway는 CLI 배포 — 백엔드 변경 시 `cd back && npx -y @railway/cli up --service dotarcade-back --detach`
- Railway 서비스의 `/app/server/data`에는 영구 볼륨 `dotarcade-back-volume`이 연결되어 있어 프로필·게임·회의 체크포인트가 재배포/재시작 뒤에도 유지된다.
- 프론트 `/api`·`/play` → Railway 백엔드로 서버사이드 리라이트 (`front/vercel.json`) — 쿠키·SSE 통과 확인됨

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

## 2. 백엔드 — Railway (Docker)

요구 사항: Node 20+, `git` 바이너리, 재시작 전까지 유지되는 디스크 → `back/Dockerfile`(node:20-alpine + git)로 충족.

- **배포**: `cd back && npx -y @railway/cli up --service dotarcade-back --detach`
- **환경변수**: 루트 `.env`의 `BACK_*` 키가 Railway 서비스 변수로 등록되어 있음 (`BACK_PORT=8080`으로 오버라이드, 도메인이 8080 포트로 연결됨). 키 변경 시: `npx -y @railway/cli variables --set "KEY=VALUE" --service dotarcade-back`
- **영속 데이터**: Railway 볼륨 `dotarcade-back-volume`을 컨테이너의 `/app/server/data`에 마운트한다. 이 마운트를 제거하거나 다른 경로로 바꾸면 브라우저별 프로필·게임 저장소·회의 체크포인트가 새 저장소에서 시작되므로 배포 설정 변경 전 백업을 확인한다.
- `render.yaml`은 Render로 옮길 경우를 위한 대안 블루프린트로 남겨둠

## 3. 로컬 개발 (변경 없음)

```bash
cd back && npm run dev     # :5175
cd front && npm run dev    # :5173, /api·/play → :5175 프록시
```
