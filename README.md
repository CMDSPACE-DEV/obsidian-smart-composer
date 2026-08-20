# CMDS Achmage

<img width="509" height="635" alt="CMDS Achmage_example_1" src="https://github.com/user-attachments/assets/eaa92354-130d-4f9c-9824-d78aa769e221" />
<img width="558" height="353" alt="CMDS Achmage_example_4" src="https://github.com/user-attachments/assets/0e8a0e9b-5506-4ff0-8717-03900fd3f131" />
<img width="508" height="649" alt="CMDS Achmage_example_3" src="https://github.com/user-attachments/assets/42a69b2c-71b5-49b0-aa9a-76ffd08386fe" />
<img width="506" height="643" alt="CMDS Achmage_example_2" src="https://github.com/user-attachments/assets/acc5f17f-106d-4737-a72e-8a50ff2a536c" />

CMDS Achmage(플러그인 ID: `cmds-achmage`)는 Heesu Suh의 Smart Composer(`glowingjade/obsidian-smart-composer`)를 포크한 업데이트 & 개량 버전입니다.
원본 출처 링크 : https://github.com/glowingjade/obsidian-smart-composer
이 저장소 : https://github.com/CMDSPACE-DEV/CMDS-Achmage

- 추가 업데이트 및 수정 내용
  - v1.4.0 Plan 모델: GPT-5.6 Sol/Terra/Luna와 Claude Sonnet 5
    - GPT-5.6 모델별로 `none`, `low`, `medium`, `high`, `xhigh`, `max` 추론 강도를 독립 설정
    - Claude Sonnet 5 Adaptive Thinking, 추론 강도, thinking summary 표시 설정 지원
    - 채팅 입력창에서 현재 추론 강도를 바로 확인하고 변경하는 빠른 effort 선택기 추가
    - 기존 gpt-5.5 (plan)과 Claude Sonnet 4.6 (plan) 설정은 업데이트 시 새 Plan 모델로 이전
  - RAG 임베딩이 원래 **OpenAI API키로만 폴더 멘션/임베딩을 할 수 있도록 하드코딩된 버그**가 있었습니다.
    - Plan 모드로도 API 키 아예 없이도 폴더 멘션 및 청크, 임베딩이 가능하도록 개선 (API 키 제거 후 동작 확인)

## Plan 모드 주의사항

- OpenAI/Claude Plan 연결은 구독 인증과 비공개 백엔드를 사용하는 실험 기능입니다. 제공자의 모델 권한이나 백엔드 변경으로 예고 없이 작동하지 않을 수 있으며 자동으로 다른 모델로 대체하지 않습니다.
- Claude는 제3자 도구에 API 인증 사용을 권장합니다. Plan 연결 전 계정 정책과 위험 안내를 확인하세요.
- v1.4.0을 수동 설치하기 전에 기존 플러그인 폴더와 `data.json`을 통째로 백업하세요.
- API 키 기반 모델 목록은 v1.4.0에서 변경되지 않습니다.

---

커맨드스페이스 협업 레포 안내는 [docs/CMDS-COLLABORATION.md](docs/CMDS-COLLABORATION.md)를 참고하세요.
