# 레퍼런스 기반 게임 제작 파이프라인

레퍼런스 탐색은 게임별 수작업을 위한 기능이 아니라, 검색 근거를 재사용 가능한 제작 계약으로 바꾸는 자동 파이프라인이다. 사용자는 회의 시작 화면의 **레퍼런스 탐색** 체크박스만 선택하며 별도의 제작 단계는 추가되지 않는다.

## 처리 흐름

1. 안건에서 장르·핵심 루프·UI 검색 키워드를 만든다.
2. 후보 탐색 쿼리를 병렬 실행하고 중복·타임아웃·캐시를 처리한다.
3. 검색 근거와 작은 게임으로의 구현 적합도를 기준으로 타겟을 선정한다.
4. UI 데이터베이스와 대체 출처를 조회한다. 수동 검토 전용 출처는 링크와 정책만 보존한다.
5. AI 입력이 허용된 텍스트 근거와 이미 일반화된 UX 메모만으로 `reference-blueprint/v1` 계약을 추출한다.
6. 추출 실패 또는 검색 불가 시 장르별 deterministic baseline을 합쳐 완결된 계약을 만든다.
7. 동일 계약을 토론, PRD, 디자인, 아키텍처, 구현, QA 수리 프롬프트가 소비한다.
8. 게임 코드는 `meta.reference`에 계약과 실제 구현 ID를 선언한다.
9. 자동 QA는 선언뿐 아니라 화면 renderer, 상태, 깊이, 피드백 코드 신호와 런타임 렌더를 함께 검사한다.
10. 릴리스에 원본 조사, 정규화 blueprint, 구현 추적표와 QA 상태를 저장한다.

## 계약의 핵심 필드

- `schemaVersion`, `contractId`: 스키마와 추적 가능한 안정 ID
- `target`: 선정된 타겟과 선정 방식
- `coreLoop`: 목표, 동사, 단계별 행동과 피드백
- `screens`: 필수 화면의 역할, 진입·종료, 레이아웃과 주 행동
- `patterns`: 일반화 패턴, 독자적 적용 방법, 근거와 검증 기준
- `visualGrammar`: far/mid/near/UI, 원근, 광원, 그림자와 모션 원칙
- `interaction`, `requiredStates`: 입력 흐름과 검증할 화면 상태
- `implementation`: 코드 예산, 재사용 컴포넌트와 우선 삭제 순서
- `qa`: 필수 화면·패턴·상태와 깊이·피드백 신호
- `traceability`: 근거 → 패턴 → 화면 → 구현 → 검증 연결
- `originality`, `sourcePolicy`: 허용되는 추상화와 금지되는 복제
- `quality`: 근거 범위, 신뢰도, fallback 모드와 경고

필수 패턴은 미니게임 코드 예산에 맞춰 6~8개로 제한한다. 근거가 약해도 제작을 중단하지 않고 장르 baseline으로 진행하되, 검증되지 않은 세부 주장은 추가하지 않는다.

## 소스 정책

- Game UI Database처럼 수동 검토 전용인 출처의 페이지 텍스트, 메타데이터, 이미지와 픽셀은 모델 입력·다운로드·프록시·생성 에셋에 사용하지 않는다.
- UI에는 출처 링크, 화면 분류, 권리 정책과 사람이 작성한 일반화 메모만 표시한다.
- 생성 단계는 이름, 캐릭터, 실루엣, 로고, 맵, 대사, 정확한 레이아웃 비율, 아이콘, 팔레트와 픽셀아트를 복제하지 않는다.
- 정보 계층, 상호작용 흐름, 피드백 타이밍과 일반화된 공간 구성만 독자적 테마로 번역한다.

## 장애 시 동작

| 장애 | 동작 |
|---|---|
| 일부 검색 실패 | 성공한 병렬 결과만 사용하고 query run에 오류 기록 |
| 전체 검색 실패 | 장르별 deterministic blueprint 사용 |
| blueprint JSON 오류·타임아웃 | 검색 결과는 보존하고 deterministic blueprint로 대체 |
| 근거 범위 부족 | `quality.warnings` 기록 후 일반화된 baseline만 구현 |
| 코드 계약 누락 | 자동 QA 진단을 구현 모델에 전달해 최대 2회 수리 |
| 최종 QA 실패 | `unstable`로 명시하고 진단·계약 상태를 릴리스에 보존 |

## 스키마를 확장할 때

1. 기존 필드를 삭제하지 말고 additive하게 확장한다.
2. 서버 normalizer와 프론트 normalizer를 함께 갱신한다.
3. 새 필드는 deterministic fallback에도 반드시 존재해야 한다.
4. 프롬프트 선언과 QA의 객관 신호 검사를 동시에 추가한다.
5. 기존 계약, 검색 불가, 수동 전용 출처, 잘못된 모델 JSON과 mock provider 회귀 테스트를 모두 통과시킨다.

주요 구현은 `back/server/lib/reference-research.js`, `front/web/src/meeting/referenceContract.js`, `front/web/src/meeting/engine.js`, `front/web/src/game/qa.js`에 있다.
