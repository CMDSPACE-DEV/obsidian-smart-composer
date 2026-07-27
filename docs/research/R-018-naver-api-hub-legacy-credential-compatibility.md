# R-018: NAVER API HUB and Legacy Credential Compatibility

## Status

- Verified: 2026-07-27
- Implemented target: Smart Composer 2.5.1
- Mandatory for future Research Connections changes

## Trigger

A user followed a 2025 NAVER Developers Center tutorial, entered the issued
Client ID and Client Secret into Smart Composer 2.5.0, and saw an error that
contained the number `200`.

## Verified Finding

The number was not an HTTP 200 success response. A request without valid NAVER
API HUB credentials returns:

```text
HTTP 401 Unauthorized
error.errorCode = "200"
error.message = "Authentication Failed"
```

NAVER currently has two non-interchangeable Search API contracts:

| Contract | Endpoint | Authentication headers |
| --- | --- | --- |
| NAVER API HUB | `https://naverapihub.apigw.ntruss.com/search/v1/...` | `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` |
| NAVER Developers legacy | `https://openapi.naver.com/v1/search/....json` | `X-Naver-Client-Id`, `X-Naver-Client-Secret` |

The 2025 tutorial at `https://armin.tistory.com/794` describes the legacy
Developers Center contract, not the NAVER Cloud API HUB contract.

NAVER's transition notice says existing legacy Search API applications may
continue through 2027-06-30, while new integrations should migrate to API HUB.

## 2.5.1 Product Decision

1. Preserve API HUB as the preferred contract.
2. Add a `Credential service` selector:
   - Auto detect
   - NAVER API HUB
   - NAVER Developers (legacy)
3. In Auto mode, call API HUB first.
4. Retry the legacy endpoint only after an authentication rejection. Do not
   retry on arbitrary network, quota, query, or server failures.
5. Reuse the existing secret IDs so saved credentials do not need to be
   re-entered.
6. Warn successful legacy users that migration is required by 2027-06-30.
7. Explain that provider `errorCode 200` is authentication failure, not HTTP
   success.

## Verification

- API HUB endpoint and headers covered by adapter tests.
- Explicit legacy endpoint and headers covered by adapter tests.
- Auto fallback covered by adapter tests.
- Dual rejection produces an actionable error.
- HTTP 401 with provider `errorCode 200` produces an unambiguous message.
- TypeScript type check passes.

## Official Sources

- [NAVER API HUB overview](https://api.ncloud-docs.com/docs/naver-api-hub-overview)
- [NAVER API HUB news search](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)
- [NAVER API HUB migration guide](https://guide.ncloud-docs.com/docs/apihub-migration)
- [NAVER Developers transition notice](https://developers.naver.com/notice/article/32973)

