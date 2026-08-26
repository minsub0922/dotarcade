# DOTCADE 제출 문안

## 1. Game Title

**DOTCADE (도트케이드)**
*Build the game. Face the arcade.*

## 2. Game Overview (200자 이내)

> 당신과 AI 팀이 만든 게임을 AI 관객이 검증하는 살아 있는 도트 오락실. 스튜디오 팀장이 되어 5명의 전문 에이전트와 BMAD 기반 10단계 회의로 실제 미니게임을 만들고, 20명의 전략형 손님에게 배포해 실플레이 데이터와 피드백으로 진화시키세요.

## 3. How You Built with Codex

Codex는 코드 자동완성을 넘어 DOTCADE 개발을 조직하는 **AI 개발 스튜디오**로 활용됐습니다. 핵심은 **BMAD-as-a-Skill**, **Codex Team Agents**, **OpenCodex Cost Optimization**, 그리고 실제 플레이로 품질을 증명하는 **Playable Eval Loop**였습니다.

### BMAD-as-a-Skill: 상황마다 교대하는 전문가 체인

BMAD Method를 custom Codex Skill로 구성해 요청 단계에 맞는 전문가 역할, 체크리스트와 산출물 순서를 호출했습니다. Analyst는 문제와 성공 기준을 Product Brief로 정리하고, PM은 범위와 수용 기준을 PRD로 고정했습니다. UX Designer와 Architect는 플레이 경험과 시스템 경계를 설계하고, PO·Scrum Master는 Epics & Stories로 실행 단위를 준비했습니다. 이후 Dev가 구현하고 QA·Reviewer가 실제 실행 증거로 검증했습니다.

**Product Brief → PRD → UX → Architecture → Stories → Implementation → QA**의 산출물이 다음 전문가의 입력이 되므로, 아이디어가 곧바로 코드로 점프하거나 구현 중 요구사항이 흔들리는 일을 줄였습니다. 게임 안의 5인·10단계 제작 회의는 이 Codex Skill 자체가 아니라, 효과를 본 BMAD 철학을 별도의 런타임 메커닉으로 재해석한 것입니다.

### Codex Team Agents: 세로형 BMAD × 가로형 병렬 제작

리드 Codex는 승인된 계약을 네 개의 bounded workstream으로 나눴습니다. **Worldsmith**는 NPC 자율 행동, **Contract Architect**는 `reference-blueprint/v1`과 요구사항 추적, **Arcade Red Team**은 20인·5전략군 sandbox 플레이테스트, **Integration Producer**는 사무실→회의→게임→오락실→리포트 UX를 맡았습니다. 이들은 영구 제품명이 아니라 책임을 선명하게 한 **Codex Team Agents(subagents)**의 역할명입니다.

각 agent에는 필요한 산출물, 파일 경계, 수용 기준과 검증 명령만 담은 **Task Capsule**을 전달했습니다. 탐색과 검증은 병렬화하되 최종 교차검토·통합·커밋은 리드가 순차 처리했습니다. 공통 Working Agreements는 **Contract before code**, **One agent–one bounded surface**, **Evidence over declaration**, **Bounded failure**, **Merge on proof**였습니다. 검증 시점 기준 프런트 99개와 백엔드 23개, 총 **122개 자동 테스트**가 통과했습니다.

### OpenCodex Cost Optimization: Plan–Execution + Context Offloading

커뮤니티 오케스트레이션 레이어 **OpenCodex**로 모델을 역할별 라우팅했습니다. 아키텍처, 작업 분해와 수용 기준처럼 실패 비용이 큰 **Plan**은 high-end Codex 모델이 만들고, 경계와 검증법이 확정된 **Execution**은 token-efficient 모델이 구현·테스트했습니다. 비용을 자동 판단하는 방식이 아니라, 명시적인 **Plan–Execution 규칙**으로 고급 추론 예산을 중요한 결정에 집중했습니다.

BMAD 산출물, 설계 결정, Story, 커밋·diff와 테스트 증거는 **GitHub Context Ledger**에 offload했습니다. Agent는 긴 대화 전체 대신 필요한 Task Capsule을 읽고, 작업 뒤에는 중요한 **Material Knowledge Delta**만 돌려주었습니다. 이는 Context Rot을 없앤다는 주장이 아니라, 대화 컨텍스트 의존도와 드리프트 위험을 낮추고 새 세션도 같은 source of truth에서 이어가게 한 방식입니다.

### Computer Use QA + Playable Eval Loop

**Codex Computer Use**가 로컬 빌드를 직접 보고 클릭·키 입력하며 사무실→제작 회의→생성 게임→오락실 리포트의 핵심 사용자 여정을 반복 플레이했습니다. 이를 통해 코드 테스트가 놓치기 쉬운 화면 도달성, 조작 반응, 레이아웃과 진행 중단을 사용자의 관점에서 발견했습니다.

반복 가능한 검사는 별도의 sandbox harness가 담당했습니다. 게임 내부의 20명 손님은 **Explorer, Score Hunter, Survivor, Bug Breaker, Learner**의 5개 전략군으로 실제 게임팩을 실행하고 화면·입력·점수·오류·행동 텔레메트리를 남겼습니다. Codex는 이 증거를 재현 절차, 기대값과 실제값, 플레이어 영향, 심각도와 수정 제안이 담긴 **Human-friendly Feedback**으로 정리했습니다. 결정적 회귀 테스트와 탐색형 Computer Use를 결합한 **Build → Play → Prove → Repair → Replay** 루프가 “실행되는 게임”을 “플레이할 만한 게임”으로 개선했습니다.

### Creative Direction과 Codex의 역할

**“회의=제작, 배포=검증, 반복=성장”**이라는 제품 철학과 5명의 제작진, 20명의 손님, 6개 평가축, 원본성의 경계, 따뜻한 오피스와 네온 오락실의 아트 방향은 DOTCADE의 Creative Direction입니다. Codex는 이 방향을 대신 정하지 않고 BMAD 전문가 체인, 병렬 workstream, 실행 가능한 계약과 테스트 증거로 번역했습니다.

결국 게임 밖에서는 Codex agent studio가 DOTCADE를 만들고, 게임 안에서는 DOTCADE의 AI studio가 다시 게임을 만듭니다. **DOTCADE는 AI로 만든 게임을 넘어, AI와 함께 만들고 검증하는 방법 자체를 플레이로 만든 재귀적 스튜디오입니다.**
