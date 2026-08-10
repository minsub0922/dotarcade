# Epics & Stories — DOTCADE

> BMAD Method · Phase 4 (SM) 산출물 · 구현 순서 = 스토리 순서

## Epic 1 — 자산 & 기반
- S1.1 아바타 시트 3장 → 26캐릭터 × 4방향 스프라이트 + 얼굴 아이콘 (완료: tools/gen_sprites.py)
- S1.2 사무실/오락실 맵 베이크 + 충돌·POI maps.json (완료: tools/gen_maps.py)
- S1.3 모노 패키지 스캐폴딩 (Express + Vite/React, dev/build/start 스크립트)

## Epic 2 — 서버
- S2.1 Gemini 프록시 (generate/stream/embed, 모델 폴백, 세마포어, 429 백오프)
- S2.2 mock 프로바이더 + 부팅 시 도달성 자동 감지
- S2.3 JSON DB + 게임 git 레포 (init/commit/tag/show/diff)
- S2.4 RAG 벡터 스토어
- S2.5 `/play/:id` 공개 플레이어 + bundle API
- S2.6 기본 게임 3종 시드

## Epic 3 — 월드
- S3.1 캔버스 월드 엔진: 맵 렌더·플레이어 이동·충돌·스케일링
- S3.2 A* + 에이전트 FSM (착석/배회/경로이동/앰비언트 말풍선)
- S3.3 상호작용 시스템 (E키: 대화/진열대/문) + 맵 전환

## Epic 4 — LLM 기능
- S4.1 1:1 대화 (스트리밍, 이력, 말풍선 동기화)
- S4.2 회의 엔진: BMAD 10단계 상태기계 + 회의실 착석 연출 + 실시간 트랜스크립트
- S4.3 코드 생성 → QA 하네스 스모크 → 수리 루프 → git 릴리즈
- S4.4 업그레이드 회의 (기존 코드+피드백 컨텍스트, 버전 증가, diff)

## Epic 5 — 게임팩 & 오락실
- S5.1 하네스/봇 (iframe srcdoc, 점수·에러·텔레메트리)
- S5.2 라이브러리 UI (상세/플레이/코드뷰어/버전로그/diff/공유)
- S5.3 오락실 시뮬: 20 페르소나 병렬 파이프라인 + 관전 연출 + 조기종료
- S5.4 피드백 대시보드 + 종합 리포트 + RAG 적재

## Epic 6 — 마감
- S6.1 설정/온보딩/토스트, 접근성(터치 컨트롤)
- S6.2 E2E (mock live 서버 + Playwright): 이동→대화→회의→게임 생성→배포→20명 피드백→업그레이드
- S6.3 README + 패키징
