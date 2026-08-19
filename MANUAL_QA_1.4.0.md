# Smart Composer v1.4.0 수동 QA

이 문서는 `release/1.4.0-plan-models`의 검증된 HEAD에만 적용합니다. 테스트를 시작하기 전에 기존 Smart Composer 플러그인 폴더와 `data.json`을 통째로 별도 위치에 복사해 두세요.

## 테스트 자산

같은 빌드에서 생성된 아래 세 파일을 항상 함께 설치합니다.

- `main.js`
- `manifest.json`
- `styles.css`

플러그인 폴더를 교체한 뒤 Obsidian을 완전히 종료하고 다시 시작합니다. 개발자 콘솔은 테스트가 끝날 때까지 열어 둡니다.

## 설치와 마이그레이션

- [ ] 깨끗한 테스트 vault에서 신규 설치가 완료된다.
- [ ] 신규 설치의 기본 Plan 모델이 GPT-5.6 Sol/`medium`과 Claude Sonnet 5 Adaptive/`high`/summary 표시로 나타난다.
- [ ] 별도 테스트 vault에서 1.3.1의 실제 `data.json`을 둔 채 업그레이드한다.
- [ ] 선택된 `gpt-5.5 (plan)`과 Apply 모델이 GPT-5.6 Sol로 이전된다.
- [ ] 선택된 `claude-sonnet-4.6 (plan)`과 Apply 모델이 Claude Sonnet 5로 이전된다.
- [ ] 기존 GPT effort는 유지되고 `minimal`은 `low`, 생략값은 `medium`으로 변환된다.
- [ ] 기존 Claude thinking OFF는 disabled로, 그 외에는 Adaptive/`high`/summary 표시로 변환된다.
- [ ] 사용자 커스텀 모델, API 키 모델, OAuth 연결 정보가 보존된다.
- [ ] Obsidian 재시작 후 모든 새 설정이 그대로 유지된다.

## 채팅 입력창 빠른 effort 선택기

- [ ] GPT-5.6 또는 Claude Sonnet 5 Plan 모델을 선택하면 모델명과 Image 버튼 사이에 현재 effort가 표시된다.
- [ ] GPT에서는 `none`, `low`, `medium`, `high`, `xhigh`, `max`를 선택할 수 있고 즉시 표시가 바뀐다.
- [ ] Claude에서는 `off`, `low`, `medium`, `high`, `xhigh`, `max`를 선택할 수 있고 `off` 뒤 effort를 다시 선택하면 Adaptive Thinking이 켜진다.
- [ ] 빠른 선택기에서 바꾼 값이 모델 설정창과 일치하고 Obsidian 재시작 후에도 유지된다.
- [ ] effort를 바꾼 직후 바로 전송해도 새 effort가 첫 요청부터 적용된다.
- [ ] 모델과 effort를 빠르게 연속 변경해도 마지막 선택이 저장되고 다른 설정을 덮어쓰지 않는다.
- [ ] GPT `none` 선택 시 reasoning summary 설정이 제거되고 Claude `off` 선택 시 저장된 effort/display 값은 보존된다.
- [ ] 지원하지 않는 모델을 선택하면 effort 선택기가 숨겨진다.
- [ ] 좁은 채팅 패널에서도 effort와 Image/Chat/Vault Chat 버튼이 겹치지 않고 모델명만 말줄임된다.
- [ ] 키보드로 effort 버튼에 포커스하고 메뉴를 열어 항목을 선택할 수 있다.

## GPT-5.6 Plan

Sol, Terra, Luna 각각에서 `none`, `low`, `medium`, `high`, `xhigh`, `max`를 한 번씩 호출해 총 18개 조합을 확인합니다.

- [ ] 요청한 모델과 effort가 모두 성공한다.
- [ ] 응답에 기록된 실제 모델이 선택한 Sol/Terra/Luna와 정확히 같다.
- [ ] `none`에서는 reasoning summary가 표시되지 않는다.
- [ ] summary가 켜진 effort에서 같은 summary 문장이 중복 출력되지 않는다.
- [ ] 각 tier에서 일반 채팅과 현재 노트 컨텍스트가 동작한다.
- [ ] 각 tier에서 폴더 RAG가 동작하며 모델 오류 때 조용히 다른 모델로 fallback하지 않는다.
- [ ] 각 tier에서 MCP 도구 호출이 동작한다.
- [ ] MCP 결과 뒤 후속 응답에서 encrypted reasoning이 정상 재생된다.

## Claude Sonnet 5 Plan

- [ ] Adaptive ON 상태에서 `low`, `medium`, `high`, `xhigh`, `max`가 각각 성공한다.
- [ ] Show thinking summary ON/OFF가 각각 의도대로 표시/숨김 처리된다.
- [ ] Adaptive OFF 상태에서 일반 채팅이 성공하고 저장된 effort/display 값은 UI에 보존된다.
- [ ] Adaptive OFF 요청에 thinking summary나 수동 budget 입력이 나타나지 않는다.
- [ ] 폴더 RAG가 explicit thinking disabled 상태로 성공한다.
- [ ] MCP 도구를 연속 두 단계 호출할 수 있다.
- [ ] thinking, signature, redacted thinking이 포함된 대화가 도구 결과 이후에도 정상 이어진다.
- [ ] 대화 저장 → Obsidian 재시작 → 같은 대화에서 도구 재호출이 성공한다.

## OAuth와 오류

- [ ] OpenAI Plan과 Claude Plan을 각각 재연결할 수 있다.
- [ ] 만료가 임박한 세션이 사용자 개입 없이 한 번 갱신된다.
- [ ] 400/403/404/429 오류가 모델과 effort를 포함해 표시되고 자동 downgrade/fallback하지 않는다.
- [ ] 오류 메시지와 개발자 콘솔에 access token, refresh token, API key가 노출되지 않는다.
- [ ] 테스트 동안 예상하지 못한 콘솔 오류가 없다.

## 출시 차단 기준

다음 중 하나라도 발생하면 브랜치 push, 태그, Release 생성을 중단합니다.

- 요청한 모델/effort에서 400, 403, 404가 발생한다.
- Terra 또는 Luna가 경고 없이 Sol로 바뀐다.
- Claude thinking signature 또는 연속 도구 호출이 실패한다.
- 설정, 커스텀 모델 또는 OAuth 정보가 유실된다.
- 자동 검사나 Obsidian 재시작 테스트가 실패한다.

## Draft Release 최종 확인

- [ ] draft Release에서 `main.js`, `manifest.json`, `styles.css`를 다시 다운로드한다.
- [ ] 깨끗한 vault에 다운로드한 세 파일만 설치해 일반 채팅, GPT 도구 호출, Claude 도구 호출을 smoke test한다.
- [ ] 다운로드 자산이 통과한 뒤에만 Release를 공개하고 Latest로 지정한다.
