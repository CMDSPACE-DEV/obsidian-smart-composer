# R-017: Power 7 Research Connections 발급·연결·사용 가이드

> [!IMPORTANT]
> **상태: 2.5.1 구현 대조 및 공식 문서 검증 완료**
>
> **대상 버전: Smart Composer Achmage 2.5.1**
>
> **작성 기준일: 2026-07-27**
>
> 이 문서는 연결 난이도가 아니라 **자료의 유용성, 권위, 실제 글쓰기
> 워크플로우**를 기준으로 모든 Research Connection을 빠짐없이 설명한다.
> 무료 정책, 호출량, 승인 방식과 외부 서비스 상태는 바뀔 수 있으므로
> 실제 발급 화면과 공식 문서를 마지막 기준으로 삼는다.

## 1. 이 기능이 하는 일

Smart Composer 2.5.1의 Research 탭은 일반 MCP 목록과 별도로 다음을
제공한다.

1. 법령·판례 검증용 **Korean Law MCP**
2. Web of Science와 SSCI 색인 검색
3. DOI·철회·정정 관계 검증
4. 세계 및 국내 학술자료 검색
5. 기업공시·국가 R&D·국가통계 검색
6. NAVER 뉴스·웹·블로그 검색
7. 의학·생명과학 문헌 검색

검색 결과는 현재 채팅 모델에 **근거 후보**로 전달된다. Smart Composer가
외부 자료를 검색한다고 해서 그 자료가 자동으로 진실이 되는 것은 아니다.

```text
검색 서비스가 자료를 찾는다
→ 공식 페이지와 식별자를 확인한다
→ 모델이 출처와 한계를 표시하며 글을 작성한다
→ 중요한 주장은 사용자가 원문에서 다시 확인한다
```

## 2. Power 7 전체 구성

Korean Law MCP는 별도 Featured Connection이고, Power 7은 아래 일곱
Research Pack을 뜻한다.

| 번호 | Pack | 포함 소스 | 가장 강한 용도 |
| --- | --- | --- | --- |
| Featured | Korean Law MCP | Korean Law MCP | 대한민국 현행 법령·조문·판례·행정규칙 검증 |
| 1 | WoS Starter | Web of Science Starter | WoS Core Collection 및 `WOS+SSCI` 색인 검색 |
| 2 | DOI Integrity | Crossref + Retraction Watch 관계 메타데이터 | DOI 확인, 정정·철회·업데이트 관계 점검 |
| 3 | OpenAlex | OpenAlex | 논문·저자·기관·인용 수·오픈액세스 탐색 |
| 4 | Korean Academic | KCI, ScienceON, RISS | 국내 학술지·과학기술 문헌·학위/서지자료 |
| 5 | Korean Facts | OpenDART, NTIS, KOSIS MCP | 기업공시·국가 R&D·공식 국가통계 |
| 6 | NAVER API HUB | NAVER 뉴스·웹·블로그 | 국내 최신 뉴스와 웹 담론 발견 |
| 7 | Biomedical | PubMed, Europe PMC | 의학·보건·생명과학 문헌 |

### 2.1 현재 구현 상태를 정확히 이해하기

| 소스 | 프로토콜 | 사이드 채팅 | 인라인 편집 | 2026-07-27 검증 상태 |
| --- | --- | --- | --- | --- |
| Korean Law | MCP | 지원 | 미지원 | 사용자 실기기 연결 확인 |
| WoS Starter | Native API | 지원 | 지원 | 어댑터·fixture 검증, 사용자 키 실검증 필요 |
| Crossref | Native API | 지원 | 지원 | 무키 실서버 검색 확인 |
| OpenAlex | Native API | 지원 | 지원 | 어댑터·fixture 검증, 사용자 키 실검증 필요 |
| KCI | Native API | 지원 | 지원 | 어댑터·fixture 검증, 사용자 키 실검증 필요 |
| ScienceON | Native API | 지원 | 지원 | 승인 endpoint별 실검증 필요 |
| RISS | Native SPARQL | 지원 | 지원 | 공개 endpoint가 비정상 응답하여 Experimental |
| OpenDART | Native API | 지원 | 지원 | 어댑터·fixture 검증, 사용자 키 실검증 필요 |
| NTIS | Native API | 지원 | 지원 | 승인 endpoint·IP별 실검증 필요 |
| KOSIS | MCP | 지원 | 미지원 | 공개 파일럿 endpoint 실검색 확인 |
| NAVER | Native API | 지원 | 지원 | 어댑터·fixture 검증, 사용자 키 실검증 필요 |
| PubMed | Native API | 지원 | 지원 | 무키 실서버 검색 확인 |
| Europe PMC | Native API | 지원 | 지원 | 무키 실서버 검색 확인 |

> [!WARNING]
> `Enabled`는 사용을 허용했다는 뜻이고 `Test connection` 성공은 현재
> 장치에서 실제 요청이 성공했다는 뜻이다. 두 상태는 같지 않다.

## 3. 공통 연결 절차

### 3.1 Native API 연결

Crossref, WoS, OpenAlex, KCI, ScienceON, RISS, OpenDART, NTIS, NAVER,
PubMed, Europe PMC는 Native API 소스다.

1. Obsidian에서 `Settings`를 연다.
2. `Smart Composer`를 선택한다.
3. 상단의 `Research` 탭을 선택한다.
4. 연결할 소스의 행을 눌러 펼친다.
5. 카드 우측의 토글을 켠다.
6. 필요한 API key와 옵션을 입력한다.
7. `Save`를 누른다.
8. `Test connection`을 누른다.
9. `Connected` 결과가 나온 뒤 채팅창에서 `@`로 소스를 선택한다.

`Test connection`은 실제 provider 요청을 수행하므로 호출량을 소비한다.
PubMed처럼 검색과 요약 조회를 연달아 수행하는 소스는 내부적으로 두 번
이상의 HTTP 요청이 생길 수 있다.

### 3.2 MCP preset 연결

Korean Law와 KOSIS는 MCP preset이다.

1. `Research` 탭에서 해당 카드를 펼친다.
2. Korean Law는 `OC credential`을 먼저 입력한다. KOSIS는 키가 없다.
3. 우측 토글을 켠다.
4. `Install MCP preset`을 누른다.
5. `MCP` 탭으로 이동한다.
6. 추가된 connection에서 `Connect and scan tools`를 누른다.
7. 도구 이름, 입력 schema와 read/write 위험도를 확인한다.
8. schema를 승인하고 connection을 Enabled 상태로 둔다.
9. 사이드 채팅에서 `@Korean Law MCP` 또는 `@KOSIS MCP`를 선택한다.

MCP는 2.5.0에서 데스크톱 전용이며 사이드 채팅에서만 호출된다. 인라인
편집에 MCP를 멘션해도 실제 호출한 척하지 않고 미지원 경고를 표시한다.

### 3.3 Source routing

Research 탭 상단의 `Source routing`은 다음 세 모드가 있다.

- `Auto + explicit @Source`: 연구 의도가 감지되면 허용된 소스를 자동
  선택하고, 사용자가 `@Source`를 선택하면 그 선택을 우선한다. 자동 선택
  수의 기본값은 두 개이며 `Maximum Auto sources`에서 1~4개로 조정한다.
- `Explicit @Source only`: 사용자가 직접 멘션한 소스만 제공한다.
- `Off`: Native Research 도구를 제공하지 않는다.

각 소스의 `Auto routing`은 별도로 설정한다.

- `Allow in Auto`: Auto가 필요하다고 판단하면 사용할 수 있다.
- `Explicit @Source only`: 사용자가 직접 멘션해야 한다.
- `Off`: Auto와 명시적 호출 모두에서 제외한다.

WoS, KCI, ScienceON, OpenDART, NTIS처럼 호출량이 제한되거나 승인된
소스는 기본적으로 `Explicit @Source only`가 안전하다.

### 3.4 Pack 멘션의 실제 의미

Pack은 설치 단위가 아니라 **활성화된 소스를 묶는 호출 단위**다.

예를 들어 KCI만 활성화하고 ScienceON과 RISS는 끈 상태에서
`@Korean Academic`을 선택하면 KCI만 제공된다. Pack 안의 모든 소스를
사용하려면 각 소스를 개별적으로 발급·저장·테스트해야 한다.

채팅창의 `@` 메뉴에는 Enabled 상태인 소스만 나타난다. Pack은 그 안에
Enabled 소스가 하나 이상 있을 때 나타난다.

## 4. Featured: Korean Law MCP

### 4.1 무엇에 유용한가

- 현행 법령명과 조문 확인
- AI가 인용한 조문이 실제 존재하는지 검증
- 판례·헌재결정·행정규칙·자치법규 탐색
- 개정 전후 비교와 법령 체계 조사
- 법률 문서의 인용 오류 점검

법률 자문이나 소송 판단을 대신하는 기능은 아니다. 중요한 사안은 법령
원문, 판결문과 자격 있는 전문가를 함께 확인해야 한다.

### 4.2 OC 발급

1. [국가법령정보 공동활용](https://open.law.go.kr/LSO/openApi/guideList.do)에
   접속한다.
2. 회원가입 후 로그인한다.
3. Open API 사용 신청 또는 API 인증키 메뉴를 연다.
4. 신청 용도를 작성한다.
5. 발급된 짧은 문자열 형태의 `OC` 값을 확인한다.

공식 API에서 `OC`는 필수 인증값이다.

- [국가법령정보 Open API 요청 규격](https://open.law.go.kr/LSO/openApi/guideResult.do)
- [Korean Law MCP 공식 저장소](https://github.com/chrisryugj/korean-law-mcp)

### 4.3 Smart Composer 입력

```text
OC credential: 발급받은 OC
```

`Install MCP preset`을 누르면 Smart Composer가 다음 공개 endpoint에
연결 정보를 만든다.

```text
https://mcp.gomdori.app/law
```

OC는 일반 설정 URL에 그대로 저장하지 않고 Obsidian SecretStorage에서
query parameter로 주입된다.

### 4.4 연결 확인

1. `Research` 탭에서 preset 설치
2. `MCP` 탭에서 `Connect and scan tools`
3. 도구 schema 검토 및 승인
4. 사이드 채팅에서 아래처럼 시험

```text
@Korean Law MCP
근로기준법 제74조의 현재 조문을 검색하고 공식 출처 URL과 검색 시점을
표시해줘. 기억으로 답하지 말고 반드시 도구를 호출해.
```

```text
@Korean Law MCP
다음 문장에 인용된 법령명과 조문이 실제 현행법과 일치하는지 팩트체크해줘.
틀리면 정확한 조문과 공식 링크를 제시해줘.
```

### 4.5 주의사항

- MCP 서버는 법제처가 직접 운영하는 서버가 아니라 공식 법제처 API를
  사용하는 제3자 오픈소스 operator다.
- 법제처 API 장애와 MCP operator 장애는 서로 다른 문제다.
- `OC`를 채팅, 스크린샷, GitHub issue 또는 Markdown 문서에 적지 않는다.

## 5. Pack 1: WoS Starter

### 5.1 무엇에 유용한가

- Web of Science Core Collection 메타데이터 검색
- `WOS+SSCI` edition을 지정한 SSCI 색인 후보 검색
- DOI, 저자, 저널명, 출판연도와 WoS UID 확인
- 논문이 특정 색인 범위에서 검색되었는지 1차 점검

WoS Starter는 논문 원문 독해 도구가 아니다. 색인 검색 결과가 논문의
주장이나 연구 품질을 증명하지도 않는다.

### 5.2 무료 API key 발급

1. [Clarivate Developer Portal](https://developer.clarivate.com/)에
   가입한다. 기존 Clarivate 계정이 있으면 같은 계정을 사용할 수 있다.
2. Developer Portal에서 개인 application을 등록한다.
3. API 목록에서 [Web of Science Starter](https://developer.clarivate.com/apis/wos-starter)를
   연다.
4. `Free Trial Plan`을 선택해 subscribe한다.
5. 발급된 API key를 복사한다.

공식 안내상 Free Trial은 기관 구독이 없는 개인도 신청할 수 있으며,
하루 50회, 초당 1회다. Free Trial 응답에는 times-cited가 포함되지 않는다.

### 5.3 Smart Composer 입력

```text
API key: Clarivate에서 발급한 키
Default editions: WOS+SSCI
```

필요에 따라 edition을 바꿀 수 있다.

```text
WOS+SSCI
WOS+SCI
WOS+AHCI
WOS+ESCI
```

여러 edition을 사용할 때는 Clarivate가 허용하는 형식과 자신의 plan
권한을 확인한다.

### 5.4 연결 확인과 사용 예

```text
@WoS Starter
"AI literacy"와 "higher education"에 관한 WOS+SSCI 색인 논문을 검색해.
제목, 저자, 연도, 저널, DOI, WoS 링크를 표로 만들고 검색된 index
coverage를 별도 열로 표시해.
```

```text
@WoS Starter
생성형 AI가 대학 글쓰기 교육에 미치는 영향을 다룬 최근 연구를 찾아줘.
SSCI 색인 여부는 결과 metadata로 확인된 것만 표시하고, 원문을 읽었다고
말하지 마.
```

### 5.5 현재 플러그인 동작과 한계

- 질문은 WoS `TS=("질문")` topic query로 변환된다.
- 한 번에 최대 50개 record를 요청한다.
- 기본 정렬은 relevance 계열이다.
- `Default editions`에 적힌 범위를 요청하지만, 반환 metadata를 다시
  확인한 뒤에만 “SSCI 색인”이라고 표현해야 한다.
- 50회/일 한도 때문에 Auto보다 명시적 `@WoS Starter` 사용을 권장한다.

## 6. Pack 2: DOI Integrity

### 6.1 무엇에 유용한가

- DOI가 실제로 등록되어 있는지 확인
- 제목·저자·저널·출판일 metadata 대조
- Crossref relation metadata에 기록된 correction, update, retraction 확인
- 참고문헌 DOI 오타와 제목 불일치 점검

### 6.2 발급

Crossref Public REST는 가입과 키가 필요 없다. 이메일을 입력하면 polite
pool을 사용해 더 높은 공개 rate limit과 연락 가능한 식별을 제공한다.

- [Crossref access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)
- [Crossref Retraction Watch integration](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/)

### 6.3 Smart Composer 입력

```text
Contact email for polite pool: 본인 이메일 (권장, 선택)
```

1. Crossref 토글을 켠다.
2. 이메일을 입력하거나 비워둔다.
3. `Save`를 누른다.
4. `Test connection`을 누른다.

### 6.4 사용 예

```text
@DOI Integrity
10.0000/example-doi의 제목, 저자, 저널과 출판일을 확인하고 정정·철회·업데이트
관계 metadata가 있는지 검사해. DOI 공식 링크도 표시해.
```

```text
@DOI Integrity
아래 참고문헌 목록에서 DOI와 논문 제목이 서로 맞는지 검증하고, Crossref에
등록되지 않았거나 correction/retraction 관계가 있는 항목을 분리해줘.
```

### 6.5 중요한 한계

- 정확한 DOI가 질문에 있으면 해당 DOI를 직접 조회한다.
- DOI가 없으면 bibliographic search를 수행한다.
- 현재 `Crossref + Retraction Watch` connector는 Crossref가 제공하는
  relation/update metadata를 해석한다.
- 별도의 Retraction Watch 전체 데이터베이스를 독립 검색하는 완전한
  철회 감사 도구는 아니다.
- 관계 metadata가 없다는 사실만으로 “철회되지 않았다”고 단정하면 안 된다.
  출판사 원문과 Crossmark도 함께 확인하는 것이 안전하다.

## 7. Pack 3: OpenAlex

### 7.1 무엇에 유용한가

- 전 세계 학술논문 발견
- 저자와 기관 정보 확인
- DOI, 인용 수와 오픈액세스 위치 탐색
- WoS 결과를 더 넓은 공개 학술 그래프로 보강
- 관련 연구 후보를 빠르게 넓히기

### 7.2 무료 API key 발급

1. [OpenAlex](https://openalex.org/) 계정을 만든다.
2. 로그인한 뒤 [API settings](https://openalex.org/settings/api)를 연다.
3. API key를 복사한다.

공식 문서는 무료 key에 매일 USD 1 상당의 사용 예산을 제공한다고
설명한다. 사용 비용은 operation에 따라 다르며, 검색 기준으로 약 1,000회,
list/filter 기준으로 약 10,000회 규모다.

- [OpenAlex Authentication & Pricing](https://developers.openalex.org/guides/authentication)

### 7.3 Smart Composer 입력

```text
API key: OpenAlex API key
```

### 7.4 사용 예

```text
@OpenAlex
"AI literacy higher education" 관련 연구를 찾아 DOI, 저자, 소속기관,
인용 수, 오픈액세스 여부와 원문 후보 링크를 표로 정리해.
```

```text
@OpenAlex
이 논문과 비슷한 주제의 연구를 찾아 학술 그래프상 발견 범위를 넓혀줘.
인용 수를 품질 점수처럼 해석하지 말고 단순 metadata로 표시해.
```

### 7.5 중요한 한계

- OpenAlex는 공개 discovery graph이지 WoS/Scopus 구독 색인 확인 도구가
  아니다.
- 인용 수는 영향의 한 지표일 뿐, 신뢰성이나 연구 품질 점수가 아니다.
- abstract가 제공되면 역색인으로 복원하지만 항상 존재하지 않는다.
- 오픈액세스 링크가 있다고 해서 Smart Composer가 논문 전체를 읽은 것은
  아니다.

## 8. Pack 4: Korean Academic

## 8.1 KCI

### 가장 강한 용도

- KCI 국내 학술지 논문 metadata 검색
- KCI 등재 자료의 제목·저자·저널·연도 확인
- 국내 학술 참고문헌 후보 발견

### API key 발급

1. [KCI](https://www.kci.go.kr/)에 로그인한다.
2. `KCI 데이터 제공` → `OPEN API`로 이동한다.
3. `KCI Open API 인증키 신청/관리`를 선택한다.
4. 용도를 작성하고 인증키를 신청한다.
5. 승인되거나 발급된 key를 확인한다.

- [KCI OPEN API 목록](https://kci.go.kr/kciportal/po/openapi/openApiList.kci)
- [KCI Open API 활용방법](https://www.kci.go.kr/kciportal/po/openapi/openApiConnSamp.kci)

### Smart Composer 입력

```text
KCI API key: 발급받은 KCI key
```

### 사용 예

```text
@KCI
"생성형 인공지능 대학 교육"을 제목에 포함하는 KCI 논문을 검색해.
논문명, 저자, 학술지, 연도, DOI/KCI 링크를 정리해.
```

### 현재 한계

- 2.5.0 adapter는 KCI `articleSearch`의 제목 검색을 사용한다.
- 자연어 의미 검색이나 본문 전체 검색이 아니다.
- 검색어를 너무 길게 쓰면 결과가 줄어드므로 핵심 명사 중심의 짧은
  query가 유리하다.

## 8.2 ScienceON

### 가장 강한 용도

- 국내외 과학기술 논문
- 국가 R&D 보고서와 과학기술 동향
- 연구자·연구기관 등 KISTI 과학기술 metadata

### 활용 신청

ScienceON은 API 종류별 신청 화면과 승인 endpoint가 다를 수 있다.
논문 검색이 목적이면 논문 검색 API를 신청해야 한다.

1. [ScienceON Open API](https://scienceon.kisti.re.kr/por/oapi/openApi.do)에
   접속하고 로그인한다.
2. 필요한 API를 선택한다. 일반 논문 검색에는 `ScienceON 논문검색`을
   우선 검토한다.
3. 활용 목적과 사용 정보를 입력해 신청한다.
4. 승인 후 provider 화면에 표시되는 request URL과 API key를 복사한다.
5. 기술문서에서 검색어 parameter와 인증키 parameter 이름을 확인한다.

공공데이터포털에도 ScienceON 논문 검색이 등록되어 있으며, 공식 안내는
ScienceON 회원가입 후 해당 API 사용 신청을 요구한다.

- [ScienceON 논문검색 안내](https://www.data.go.kr/data/15117315/openapi.do)

### Smart Composer 입력

```text
ScienceON API key: 승인된 key
Approved request URL: 승인 화면의 실제 검색 endpoint
Query parameter: provider 문서의 검색어 parameter
Key parameter: provider 문서의 인증키 parameter
```

플러그인의 기본 후보는 다음과 같지만 승인 문서를 우선한다.

```text
Query parameter: query
Key parameter: key
```

### 사용 예

```text
@ScienceON
"생성형 인공지능 미디어 교육" 관련 국내 과학기술 논문과 보고서를 검색하고,
자료 유형과 원문/상세 페이지 링크를 구분해줘.
```

### 현재 한계

- ScienceON은 API 상품별 endpoint와 response schema가 다를 수 있다.
- 2.5.0은 JSON/XML을 구조적으로 읽는 configurable adapter다.
- `Test connection`이 실패하면 key 자체보다 endpoint, query parameter,
  key parameter가 신청한 API와 일치하는지 먼저 확인한다.
- 승인된 실제 endpoint로 성공하기 전에는 production-ready라고 간주하지
  않는다.

## 8.3 RISS Linked Data

### 가장 강한 용도

- 국내 학위논문·도서·서지 Linked Data 탐색
- URI 기반 서지 record 발견
- KCI/ScienceON에서 놓친 국내 자료의 보조 탐색

### 발급과 입력

키가 필요 없다.

1. RISS 토글을 켠다.
2. `Save`를 누른다.
3. `Test connection`을 실행한다.

- [RISS SPARQL Endpoint](https://data.riss.kr/sparqlEndpoint.do)
- [RISS SPARQL 도움말](https://data.riss.kr/userguide.do)

### 사용 예

```text
@RISS Linked Data
"인공지능 리터러시"가 제목에 포함된 국내 학위논문 또는 서지자료를 찾아
제목, 저자, 연도, RISS URI를 정리해.
```

### 현재 경고

2026-07-27 실서버 점검에서는 공식 예제와 일반 검색 모두 HTTP 200을
반환하면서도 기대한 JSON 결과 대신 “조회 결과가 없습니다” 형태의 응답을
보였다. 따라서 현재는 다음 원칙을 적용한다.

- `Experimental` 보조 소스로만 사용한다.
- RISS만으로 “관련 논문이 없다”고 결론 내리지 않는다.
- `Test connection` 실패 또는 0건은 사용자 설정 오류가 아닐 수 있다.
- KCI와 ScienceON을 우선하고 RISS를 추가 discovery 경로로 둔다.

## 9. Pack 5: Korean Facts

## 9.1 OpenDART

### 가장 강한 용도

- 금융감독원 공식 기업공시 검색
- 최근 사업보고서·분기보고서·주요사항보고서 확인
- 회사가 직접 제출한 공시를 근거로 기업 관련 글 팩트체크

### 인증키 발급

1. [OpenDART](https://opendart.fss.or.kr/)에 접속한다.
2. 개인 또는 기업 회원으로 가입하고 로그인한다.
3. `인증키 신청/관리` → `인증키 신청`을 선택한다.
4. 사용환경과 용도를 작성하고 약관에 동의한다.
5. 발급된 인증키를 확인한다.

- [OpenDART 인증키 신청](https://opendart.fss.or.kr/uss/umt/EgovMberInsertView.do)
- [OpenDART 개발가이드](https://opendart.fss.or.kr/guide/main.do)

### Smart Composer 입력

```text
OpenDART API key: 발급받은 인증키
```

### 사용 예

```text
@OpenDART
삼성전자의 최근 1년 공시 중 AI, 데이터센터 또는 반도체 투자와 관련된
공시를 찾아 공시명, 접수일, 제출인과 DART 원문 링크를 정리해.
```

```text
@OpenDART
00126380
이 8자리 corp_code 기업의 최근 1년 주요 공시를 찾아줘.
```

### 현재 한계

- 8자리 `corp_code`를 질문에 직접 넣으면 가장 결정적으로 검색한다.
- 회사명을 넣으면 최근 1년 공시 metadata에서 회사명/보고서명을 로컬
  필터링한다.
- 2.5.0에는 회사명에서 corp_code를 별도 조회하는 완전한 company lookup
  단계가 아직 없다.
- 공시는 회사 제출자료라는 의미에서 1차 자료지만, 모든 내용의 정확성과
  완전성을 금융감독원이 보증한다는 뜻은 아니다.

## 9.2 NTIS

### 가장 강한 용도

- 대한민국 국가 R&D 과제 metadata
- 국가 연구개발 성과·보고서
- 기관과 연구 주제별 공공 R&D 현황 확인

### 활용 신청

1. [NTIS OpenAPI](https://www.ntis.go.kr/rndopen/api/mng/apiMain.do)에
   로그인한다.
2. 일반 사용자는 `국가R&D 과제검색 서비스(전체용)`의 `활용신청`을
   우선 선택한다.
3. 연구성과가 필요하면 `국가R&D 성과검색 서비스(전체용)`도 별도로
   신청한다.
4. 승인 후 API key, request URL, 검색어 parameter를 확인한다.
5. 신청 화면에 IP 등록이 있으면 실제 Obsidian을 사용할 네트워크 조건을
   확인한다.

NTIS는 같은 key를 사용하더라도 API 상품별 활용 신청이 필요할 수 있다.
일반 사용자는 기관용 대신 대국민/전체용 서비스를 선택한다.

### Smart Composer 입력

```text
NTIS API key: 승인된 key
Approved request URL: 신청한 API의 실제 endpoint
Query parameter: searchWord
Key parameter: apprvKey
```

provider 문서에 다른 parameter가 표시되면 그 값을 사용한다.

### 사용 예

```text
@NTIS
"생성형 AI 교육" 관련 국가R&D 과제를 검색하고 과제명, 수행기관,
연구기간, 책임자, 과제 ID와 공식 상세 링크를 정리해.
```

### 문제 해결

- `유효한 인증키가 아닙니다`: 해당 API 상품의 활용 신청 여부 확인
- `접근 허용 IP가 아닙니다`: 신청한 IP와 현재 네트워크 확인
- 결과 0건: 검색어를 짧게 줄이고 `Query parameter` 확인
- 403/승인 오류: 승인 상태와 key 유효기간 확인

## 9.3 KOSIS MCP

### 가장 강한 용도

- 통계청 KOSIS 국가통계표와 지표 탐색
- 지역·기간·단위가 있는 공식 통계 확인
- 글 속 수치의 출처와 표 ID 확인

### 연결

현재 공개 파일럿 endpoint는 인증이 없다.

1. KOSIS 카드를 펼친다.
2. 토글을 켠다.
3. `Install MCP preset`을 누른다.
4. `MCP` 탭으로 이동한다.
5. `Connect and scan tools`를 누른다.
6. 발견된 도구를 검토하고 승인한다.

Smart Composer가 설치하는 endpoint:

```text
https://kosismcp2026.vercel.app/api/mcp
```

### 사용 예

```text
@KOSIS MCP
최근 10년 대한민국 합계출산율 공식 통계를 찾아 연도, 값, 단위, 통계표 ID와
KOSIS 원문 URL을 표시해. 수치가 없는 연도는 추정하지 마.
```

```text
@KOSIS MCP
강원특별자치도와 전국의 최근 청년 고용률을 동일 기준 통계표에서 비교해줘.
단위와 조사 기준이 다르면 비교를 중단하고 차이를 설명해.
```

### 현재 한계

- KOSIS 공식 데이터를 조회하지만 MCP endpoint 자체는 공개 파일럿
  operator다.
- endpoint 운영정책과 가용성이 바뀔 수 있다.
- 도구 수가 많으므로 Auto보다 명시적 `@KOSIS MCP` 사용이 안전하다.
- MCP이므로 2.5.0 인라인 편집에서는 호출되지 않는다.

## 10. Pack 6: NAVER API HUB

### 10.1 왜 설정할 가치가 큰가

NAVER API HUB는 다른 학술·공식 DB가 잡지 못하는 다음 영역에 강하다.

- 대한민국 최신 뉴스
- 국내 웹문서
- 국내 블로그와 현장 담론
- 한국어 고유명사와 최신 사건의 발견
- 공시·법령·논문 검색 전에 조사해야 할 현재 이슈

검색 결과는 발견 단계다. 기사 제목과 snippet만 보고 사실을 확정하지 말고
원문 언론사와 공식 발표를 다시 확인해야 한다.

### 10.2 신규 API HUB 발급

기존 NAVER Developers Center의 Client ID/Secret은 신규 API HUB에
사용할 수 없다.

2025년 작성된
[NAVER Developers 뉴스 API 발급 안내](https://armin.tistory.com/794)는
`developers.naver.com`에서 구형 Search API 애플리케이션을 만드는 절차다.
이 절차에서 받은 Client ID/Secret은 아래 API HUB 주소에 그대로 사용할 수
없다. 기존 애플리케이션은 2027년 6월 30일까지 유예 지원되지만 신규 구성은
API HUB를 권장한다.

1. [NAVER Cloud Platform](https://www.ncloud.com/) 계정을 만들고
   console에 로그인한다.
2. Services에서 `NAVER API HUB`를 찾아 이용 신청한다.
3. NAVER API HUB의 `Application` 메뉴를 연다.
4. 새 Application을 등록한다.
5. 사용할 Search API를 선택한다. 이 플러그인은 다음 vertical을 지원한다.
   - 뉴스: `news`
   - 한국 웹문서: `webkr`
   - 블로그: `blog`
6. Application의 `인증 정보`에서 다음 두 값을 확인한다.
   - Client ID
   - Client Secret

공식 이관 가이드:

- [NAVER API HUB 이관 가이드](https://guide.ncloud-docs.com/docs/apihub-migration)
- [NAVER API HUB 개요](https://guide.ncloud-docs.com/docs/apihub-overview)
- [뉴스 검색 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)

### 10.3 Smart Composer 입력값 대응

플러그인 표기와 NAVER console 표기를 다음처럼 대응한다.

```text
Smart Composer Client ID          = NAVER Client ID
Smart Composer Client Secret      = NAVER Client Secret
Credential service               = Auto detect | API HUB | Developers legacy
Default search vertical           = news | webkr | blog
```

내부 요청 header는 신규 API HUB 규격을 사용한다.

```text
X-NCP-APIGW-API-KEY-ID: Client ID
X-NCP-APIGW-API-KEY: Client Secret
```

2.5.1부터 `Auto detect`는 먼저 위 API HUB 규격을 사용하고, 인증 거절일
때만 기존 Developers 규격인 `X-Naver-Client-Id`와
`X-Naver-Client-Secret`으로 한 번 재시도한다. 구형 경로로 연결되면
테스트 결과에 2027년 6월 30일 이관 기한을 표시한다.

### 10.4 연결 확인

1. NAVER 카드 토글 활성화
2. `Credential service`는 기본 `Auto detect` 유지
3. `Client ID` 입력
4. `Client Secret` 입력
5. 기본 검색면을 `News`로 설정
6. `Save`
7. `Test connection`

공식 뉴스 검색 문서 기준 Search API 호출 한도는 하루 25,000회다.
요금과 무료 제공 정책은 NAVER Cloud console의 현재 상품 정책을 다시
확인한다. 25,000회는 호출 상한 설명이지 영구 무료 보장은 아니다.

### 10.5 사용 예

```text
@NAVER API HUB
최근 7일간 국내 언론이 보도한 "대학 생성형 AI 교육" 뉴스를 찾아
언론사, 기사 제목, 보도일, 원문 링크를 정리하고 중복 보도를 묶어줘.
기사 snippet을 사실 확정 근거로 쓰지 마.
```

```text
@NAVER API HUB
vertical을 webkr로 사용해 국내 대학이 공개한 생성형 AI 가이드라인을
찾아줘. 대학 공식 도메인과 일반 블로그를 구분해.
```

```text
@NAVER API HUB
vertical을 blog로 사용해 실제 사용자들이 Obsidian AI 플러그인에 대해
겪는 불편을 탐색하되, 개인 경험과 검증된 사실을 분리해.
```

### 10.6 오류 해결

- `errorCode: 200`: HTTP 성공 코드가 아니라 API HUB의
  `Authentication Failed` 오류다.
- 2025년 Developers Center 안내를 따라 발급했다면 `Auto detect` 또는
  `NAVER Developers (legacy)`를 선택한다.
- API HUB를 선택했다면 NAVER Cloud Platform의 NAVER API HUB
  Application에서 발급된 Client ID/Secret인지 확인한다.
- Client ID/Secret 혼동: 두 값이 같은 Application에서 발급된 한 쌍인지
  확인한다.
- 뉴스만 검색됨: `Default search vertical` 또는 질문의 vertical 확인
- 429/한도 초과: console의 이용량과 일일 한도 확인
- 결과 링크가 2개인 경우: plugin은 `originallink`를 우선 사용한다.
- 결과 내용이 짧음: NAVER는 기사 본문이 아니라 검색 snippet을 제공한다.

## 11. Pack 7: Biomedical

## 11.1 PubMed

### 가장 강한 용도

- 의학·보건·생명과학 문헌 검색
- PMID, DOI, 저널, 저자와 출판일 확인
- biomedical 주장의 1차 문헌 후보 발견

### 키 없이 사용

PubMed E-utilities는 key 없이 사용할 수 있다.

1. PubMed 토글을 켠다.
2. Contact email을 입력한다. 선택이지만 운영상 권장한다.
3. API key는 비워둔다.
4. `Save`와 `Test connection`을 실행한다.

키가 없으면 같은 IP에서 초당 3회 제한을 적용한다.

### 무료 key 발급

1. [NCBI account](https://www.ncbi.nlm.nih.gov/account/)를 만든다.
2. 로그인 후 우측 상단 사용자 이름을 눌러 `Account Settings`를 연다.
3. `API Key Management`에서 `Create an API Key`를 누른다.
4. 생성된 key를 복사한다.

key를 사용하면 기본 초당 10회까지 허용된다.

- [NCBI E-utilities usage policy](https://www.ncbi.nlm.nih.gov/sites/books/NBK25497/)
- [NCBI API key 설정](https://www.ncbi.nlm.nih.gov/books/NBK53593/?report=reader)

### Smart Composer 입력

```text
Optional NCBI API key: 발급받은 key 또는 빈칸
Contact email: 유효한 이메일
```

### 사용 예

```text
@PubMed
"large language models medical education" 관련 최근 systematic review와
임상/교육 연구를 찾아 PMID, DOI, 연구 유형, 저널, 연도를 정리해.
검색 metadata만으로 연구결과를 단정하지 마.
```

### 현재 한계

- plugin은 ESearch 후 ESummary를 호출한다.
- PMID와 요약 metadata는 얻지만 모든 논문의 abstract/full text를 읽는
  경로는 아니다.
- 임상 결론은 논문 원문, 연구 설계, 표본과 최신 systematic review를
  별도로 검토해야 한다.

## 11.2 Europe PMC

### 가장 강한 용도

- 생명과학·의학 문헌의 추가 discovery
- citation count와 open-access 위치 확인
- 일부 abstract와 PMC/Europe PMC record 탐색
- PubMed 결과 보강

### 연결

API key가 필요 없다.

1. Europe PMC 토글을 켠다.
2. `Save`를 누른다.
3. `Test connection`을 누른다.

- [Europe PMC REST API](https://europepmc.org/RestfulWebService)

### 사용 예

```text
@Europe PMC
"AI-assisted diagnosis radiology" 관련 최근 연구를 검색해 DOI, PMID,
인용 수, 오픈액세스 여부와 Europe PMC 링크를 정리해.
```

```text
@Biomedical
"generative AI medical education"에 대해 PubMed와 Europe PMC를 함께
검색하고 DOI/PMID로 중복을 제거해. 논문 metadata와 실제 연구 결론을
구분해 서술해.
```

### 현재 한계

- Europe PMC coverage는 biomedical/life-science에 가장 강하다.
- `isOpenAccess`는 접근 가능성 metadata이며 자동 원문 독해 완료 표시가
  아니다.
- 인용 수는 신뢰도 점수가 아니다.

## 12. 가장 강력한 실제 워크플로우

이 절의 순서는 설정 난이도가 아니라 글쓰기 가치와 검증 구조를 기준으로
한다.

### 12.1 SSCI 학술 팩트체크

```text
@WoS Starter @DOI Integrity @OpenAlex
"AI literacy higher education" 관련 WOS+SSCI 논문을 검색하고,
1) WoS 색인 record
2) Crossref DOI·정정·철회 관계
3) OpenAlex 저자·기관·인용·OA metadata
를 DOI 기준으로 합쳐 표로 만들어줘.
색인됨, peer reviewed, 원문이 주장을 지지함을 서로 다른 판단으로 표시해.
```

역할:

```text
WoS       → 지정 색인 범위 검색
Crossref  → DOI와 editorial relation 검증
OpenAlex  → 공개 학술 그래프 보강
```

### 12.2 국내 학술자료 조사

```text
@Korean Academic
"생성형 AI 미디어 교육" 관련 국내 논문과 학위자료를 KCI, ScienceON,
RISS에서 찾아 DOI/KCI ID/URI로 중복을 제거해. 어느 소스에서 발견했는지
표시하고 RISS 장애나 0건을 전체 자료 부재로 해석하지 마.
```

### 12.3 국내 최신 이슈를 공식 근거로 검증

```text
@NAVER API HUB @Korean Law MCP @KOSIS MCP
최근 국내에서 보도된 청년고용 정책 이슈를 찾아
1) NAVER 뉴스로 보도 흐름 발견
2) 관련 현행 법령 확인
3) KOSIS 공식 통계 확인
순서로 팩트체크해. 기사, 법령, 통계를 서로 다른 근거 유형으로 표시해.
```

MCP가 포함되므로 이 조합은 사이드 채팅에서 사용한다.

### 12.4 기업·산업 글쓰기

```text
@NAVER API HUB @OpenDART
최근 1년 삼성전자의 AI/데이터센터 관련 보도와 공식 공시를 비교해.
언론 보도 주장 중 공시로 확인되는 것, 확인되지 않는 것, 표현이 다른 것을
분리하고 각각 원문 링크를 달아줘.
```

### 12.5 국가 연구개발 조사

```text
@NTIS @ScienceON
"AI 기반 대학 교육" 관련 국가R&D 과제와 연구보고서/논문을 검색해.
과제 metadata와 연구 산출물을 ID와 공식 URL로 연결하되 같은 이름만으로
동일 과제나 동일 논문이라고 합치지 마.
```

### 12.6 의학·보건 글쓰기

```text
@Biomedical @DOI Integrity
"social media adolescent mental health" 관련 최근 systematic review를
PubMed와 Europe PMC에서 찾고 DOI를 Crossref로 검증해.
철회·정정 관계, PMID, DOI, 연구 유형, 연도를 표시하고 의학적 조언은
논문 검색 결과만으로 단정하지 마.
```

## 13. 사이드 채팅과 인라인 편집 사용법

### 13.1 사이드 채팅

Native API와 MCP를 모두 사용할 수 있다.

1. 입력창에서 `@`를 입력한다.
2. Research source 또는 Research pack을 선택한다.
3. “검색해”, “공식 URL을 표시해”, “도구를 실제 호출해”처럼 행동을
   명시한다.
4. 검색 결과의 tool card와 최종 답변 출처를 확인한다.

단순히 소스를 멘션했다고 해서 모델이 반드시 원하는 깊이로 검색하는 것은
아니다. 검색 목적, 기간, 자료 유형, 필요한 열과 검증 규칙을 함께 쓴다.

### 13.2 인라인 편집

Native API source와 pack을 멘션해 병렬 인라인 편집에 사용할 수 있다.

```text
@WoS Starter @DOI Integrity
선택 영역의 학술 주장을 검색 결과와 대조해 잘못된 DOI를 수정하고,
확인할 수 없는 문장은 단정형을 피하도록 고쳐줘.
```

```text
@NAVER API HUB
선택 영역의 최신 국내 사례를 검색해 날짜와 출처 링크를 보강하되,
원문을 확인하지 못한 내용은 추정하지 마.
```

Korean Law와 KOSIS처럼 MCP 기반 source는 2.5.0 인라인에서 실행되지
않는다. MCP 결과가 필요한 편집은 먼저 사이드 채팅에서 조사하고 결과를
노트로 저장한 뒤 그 노트를 인라인에 멘션한다.

## 14. Source별 권위와 역할

| Source | 역할 | 강한 주장 | 단독으로 말하면 안 되는 주장 |
| --- | --- | --- | --- |
| Korean Law | official-data bridge | 공식 법령 API에서 해당 조문을 조회함 | 법률적 결론이 확정됨 |
| WoS | index | 지정 WoS edition 검색 결과에 포함됨 | 원문이 특정 주장을 입증함 |
| Crossref | verify | DOI와 relation metadata가 확인됨 | 모든 철회 가능성이 완전히 배제됨 |
| OpenAlex | discover | 공개 학술 그래프에서 관련 record 발견 | SSCI/Scopus 구독 색인 확정 |
| KCI | index | KCI 검색 record 발견 | 논문 내용과 품질이 검증됨 |
| ScienceON | index/discover | 승인 API에서 record 발견 | 모든 국내 과학기술 문헌을 포괄함 |
| RISS | discover | Linked Data URI 발견 | 현재 RISS 전체 검색 결과를 대표함 |
| OpenDART | official | 공식 제출 공시 metadata 확인 | 회사 주장 전체가 사실로 입증됨 |
| NTIS | official | 국가R&D 과제/성과 metadata 확인 | 해당 연구가 성공하거나 우수함 |
| KOSIS | official-data bridge | 공식 통계표의 값과 단위 확인 | 서로 다른 조사 기준 통계를 직접 비교 가능 |
| NAVER | discover | 해당 뉴스/웹 결과가 검색됨 | 기사 내용이 사실로 검증됨 |
| PubMed | index | PMID record가 검색됨 | 임상적 결론이 확정됨 |
| Europe PMC | discover | 생명과학 record/OA 위치 발견 | 모든 원문을 읽고 검증함 |

## 15. 오류 해결

### 15.1 `@` 메뉴에 소스가 보이지 않는다

- Research 카드의 Enabled 토글 확인
- `Save` 여부 확인
- Pack은 포함 소스가 하나 이상 Enabled인지 확인
- 설정 변경 후 채팅 입력창을 다시 열어 확인

### 15.2 `Test connection` 버튼이 비활성화된다

- 카드 우측 Enabled 토글을 먼저 켠다.
- 필수 key와 option을 입력하고 `Save`한다.

### 15.3 `Required credentials or options are missing`

- 필수 API key 누락
- ScienceON/NTIS의 approved endpoint 누락
- option을 입력했지만 `Save`하지 않은 경우
- 이 컴퓨터의 SecretStorage에 key가 없는 경우

### 15.4 새 컴퓨터에서 기존 connection이 실패한다

Dropbox는 plugin 설정과 Enabled 상태를 동기화할 수 있지만 API key와
OC는 Obsidian SecretStorage에 장치별로 저장된다.

새 PC에서는:

1. 각 Native source의 key를 다시 입력한다.
2. Korean Law OC를 다시 입력한다.
3. MCP connection을 다시 Connect/scan한다.
4. 모든 source에서 `Test connection`을 다시 수행한다.

이 동작은 불편하지만 secret이 Dropbox와 Git에 평문 동기화되지 않게 하는
의도된 보안 경계다.

### 15.5 401 또는 403

- key 복사 시 앞뒤 공백 제거
- 발급 서비스와 endpoint가 일치하는지 확인
- NAVER는 구형 Developers key가 아닌 API HUB key인지 확인
- ScienceON/NTIS는 해당 API 상품이 승인됐는지 확인
- NTIS는 허용 IP와 유효기간 확인

### 15.6 429

- 일일/초당 호출 한도 확인
- 잠시 기다린 뒤 재시도
- Auto에서 저한도 소스를 빼고 explicit-only로 변경
- 같은 질문의 반복 실행을 줄인다.

### 15.7 MCP preset은 설치됐지만 도구가 없다

1. `MCP` 탭으로 이동
2. connection Enabled 확인
3. `Connect and scan tools`
4. schema review 승인
5. schema가 변경되었다면 다시 검토

### 15.8 RISS가 0건 또는 non-JSON 응답

현재 공개 endpoint 문제일 수 있다. KCI/ScienceON을 병행하고 RISS
결과만으로 자료 부재를 판단하지 않는다.

### 15.9 검색 결과는 나오지만 답변이 자료를 과장한다

prompt에 다음 문장을 추가한다.

```text
검색 metadata와 실제 원문 독해를 구분해.
검색 결과에 없는 내용을 추론으로 채우지 마.
각 주장마다 source role과 공식 URL을 표시해.
색인, peer review, 원문 지지를 서로 다른 판단으로 표시해.
```

## 16. 개인정보·보안·비용

### 16.1 SecretStorage

다음 값은 Obsidian SecretStorage에 장치별로 저장된다.

- Korean Law OC
- WoS key
- OpenAlex key
- KCI key
- ScienceON key
- OpenDART key
- NTIS key
- NAVER Client ID와 Client Secret
- 선택적 NCBI key

이 값을 다음 위치에 기록하지 않는다.

- `data.json`
- Markdown 노트
- 채팅 메시지
- 스크린샷
- Git commit
- issue/bug report

### 16.2 외부 전송

Research source를 호출하면 검색 query가 해당 외부 provider로 전송된다.
비밀 문서의 문장 전체를 검색어로 보내지 말고 공개해도 되는 핵심 키워드로
줄이는 것이 안전하다.

### 16.3 호출량

- Auto는 편리하지만 불필요한 외부 요청을 만들 수 있다.
- WoS와 승인형 API는 explicit-only가 적절하다.
- `Test connection`도 실제 호출량을 소비한다.
- 무료, Free Trial, 공개 파일럿과 임시 무료 정책은 영구 권리가 아니다.

## 17. 전체 구축 체크리스트

### Featured

- [ ] 국가법령정보 OC 발급
- [ ] Korean Law MCP preset 설치
- [ ] MCP 도구 scan/review
- [ ] 법령 조문 실검색 성공

### Pack 1

- [ ] Clarivate application 등록
- [ ] WoS Starter Free Trial subscribe
- [ ] API key 저장
- [ ] `WOS+SSCI` 실검색 성공

### Pack 2

- [ ] Crossref 활성화
- [ ] polite pool 이메일 입력
- [ ] DOI 직접 조회 성공
- [ ] correction/retraction relation 결과 확인

### Pack 3

- [ ] OpenAlex 계정 생성
- [ ] API key 저장
- [ ] DOI·인용 수·OA metadata 검색 성공

### Pack 4

- [ ] KCI Open API key 발급 및 테스트
- [ ] ScienceON 논문검색 API 활용 신청
- [ ] ScienceON 승인 endpoint/parameter 테스트
- [ ] RISS는 Experimental로 별도 테스트

### Pack 5

- [ ] OpenDART 인증키 발급 및 공시 검색
- [ ] NTIS 전체용 API 활용 신청
- [ ] NTIS endpoint/key/IP 테스트
- [ ] KOSIS MCP preset scan/review
- [ ] KOSIS 공식 통계표 검색 성공

### Pack 6

- [ ] NAVER Cloud API HUB 이용 신청
- [ ] Search Application 등록
- [ ] Client ID/Client Secret 저장
- [ ] news 검색 성공
- [ ] webkr 검색 성공
- [ ] blog 검색 성공

### Pack 7

- [ ] PubMed 무키 검색 성공
- [ ] NCBI key 선택 발급
- [ ] Europe PMC 검색 성공
- [ ] DOI/PMID 중복 정리 workflow 테스트

## 18. 다음 UI 개선에 반드시 반영할 사항

2.5.0은 adapter와 설정 필드를 제공하지만 발급 onboarding은 충분하지 않다.
다음 설정 UI 개편은 이 문서를 제품 안으로 옮겨야 한다.

1. 각 source에 `즉시 사용`, `무료 key`, `승인 필요`, `파일럿`,
   `Experimental` badge 표시
2. `Enabled`, `Configured`, `Verified on this device`를 별도 상태로 표시
3. 공식 발급 페이지를 여는 `Get key` 버튼
4. 카드 안 단계별 발급 안내
5. `Save and test` 통합 버튼
6. source별 sample query 버튼
7. Pack별 `n개 중 n개 연결됨` 진행률
8. ScienceON/NTIS raw endpoint와 parameter를 `Advanced` 아래로 이동
9. RISS를 pack ready 계산에서 제외
10. 실패 메시지에 provider별 해결 방법 표시
11. 새 PC에서 secret 재입력이 필요하다는 장치 경고
12. NAVER field를 `Client ID`, `Client Secret`으로 provider 용어와 일치

## 19. 검증 기록과 알려진 미확인 사항

### 19.1 실서버 무키 테스트

2026-07-27 다음 비밀정보 없는 공개 요청을 점검했다.

- Crossref: 검색 결과 반환
- PubMed: PMID 검색 결과 반환
- Europe PMC: 검색 결과 반환
- RISS: HTTP 응답은 있었으나 공식 예제에서도 usable JSON 결과 실패

R-015에서 KOSIS 공개 MCP 초기화, tool 목록과 공식 통계 검색을 확인했다.
Korean Law MCP는 실제 사용자 환경에서 연결과 법령 검색이 확인되었다.

### 19.2 아직 사용자 key로 검증해야 하는 항목

- WoS Free Trial key와 `WOS+SSCI` 실제 entitlement
- OpenAlex 사용자 key
- KCI 사용자 key
- ScienceON 승인 endpoint
- OpenDART 사용자 key
- NTIS 승인 endpoint, key와 IP
- NAVER API HUB Client ID/Secret

adapter fixture가 통과한 것과 실제 사용자 credential이 production endpoint에서
성공하는 것은 구분한다.

### 19.3 비밀정보

이 문서와 조사 기록에는 API key, OC, Client Secret, OAuth token, 개인
검색 query 또는 vault 문서 내용이 기록되지 않았다.
