# 🕹️ DOTCADE Front

멀티에이전트 게임 스튜디오 & 오락실 운영 시뮬레이션의 **프론트엔드** (Vite + React + zustand).
캔버스 월드 엔진(A*·FSM·말풍선), BMAD 회의 오케스트레이터 UI, 게임팩 샌드박스 하네스, 오락실 시뮬 패널을 담당합니다.

백엔드 레포: `../back` (dotcade-back, Express — :5175)

## 실행

```bash
npm install          # 개발·빌드 시에만 필요
npm run dev          # 개발 모드: http://localhost:5173 (/api·/play → :5175 프록시)
npm run build        # web/dist 프로덕션 번들 생성
npm start            # 배포 모드: web/dist 서빙 + /api·/play 프록시 (런타임 의존성 없음)
```

- 배포 서버(`serve.js`)는 Node 내장 모듈만 사용하므로 `node_modules` 없이도 동작합니다 (단, 빌드된 `web/dist` 필요).
- 포트 변경: `FRONT_PORT`(기본 5173), 백엔드 주소: `BACK_ORIGIN`(기본 `http://localhost:5175`).
- 백엔드가 먼저 떠 있어야 API·공유 플레이(`/play/<게임id>`)가 동작합니다.

## 구조

```
web/src/     엔진(engine)·회의(meeting)·오락실(arcade)·게임 하네스(game)·UI 패널(ui)·상태(state)
web/public/  도트 에셋 — 맵 2종·캐릭터 스프라이트 26종·harness.js
tools/       에셋 생성 스크립트 (Python3 + Pillow, 레포 루트에서 실행)
```
