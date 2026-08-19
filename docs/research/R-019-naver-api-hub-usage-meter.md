# R-019: NAVER API HUB Usage Meter

## Status

- Verified: 2026-07-27
- Implemented target: Smart Composer 2.5.2
- Mandatory for future Research Connections and quota-monitoring changes

## Trigger

A live NAVER API HUB News connection worked in Smart Composer. One user prompt
caused several model-selected search calls, and the NAVER Cloud console showed
`18 / 25,000` for the day and `18 / 775,000` for the month. Checking that
console or configuring email/SMS notifications outside Obsidian interrupted the
writing workflow.

## Verified Findings

1. NAVER usage is counted per HTTP API call, not per user prompt.
2. One chat turn can call a research tool more than once. `Test connection`
   also performs a live provider request.
3. A Smart Composer cache hit does not make a provider request and must not
   increment the meter.
4. NAVER Search quota is integrated across Search APIs that use the same key.
   NAVER documents a maximum of 775,000 Search calls per month during the
   current free period and a 50 RPS key limit.
5. NAVER's public user guide directs users to the Cloud console for usage
   status, success/failure graphs, limits, and threshold notifications.
6. The reviewed public NAVER API HUB request/response documentation does not
   document a quota-used or quota-remaining response header, nor a
   least-privilege usage-reading endpoint authenticated by the API HUB Client ID
   and Client Secret.
7. Ncloud management APIs use an IAM Access Key and Secret Key. Those
   credentials can carry much broader cloud-account permissions than a NAVER
   API HUB search key. Requesting them only to draw a meter is not an acceptable
   default security tradeoff.

Finding 6 is a documentation-boundary finding: it means no supported endpoint
was found in the reviewed official material, not that NAVER could never publish
one later.

## 2.5.2 Product Decision

1. Count responses centrally in `ResearchHttpClient`, where actual network
   traffic can be distinguished from prompts and cache hits.
2. Count only requests to `naverapihub.apigw.ntruss.com` in the API HUB meter.
   Legacy `openapi.naver.com` traffic is a separate contract and is excluded.
3. Store KST daily buckets with total, successful, and failed response counts.
   Retain 93 daily buckets and derive the current month from them.
4. Show Today and This month progress in the expanded NAVER Research card.
5. Default comparison limits to 25,000 daily and 775,000 monthly, while allowing
   the user to match values shown in their own console.
6. Label the display `Smart Composer tracker`, not official NAVER usage.
7. State that calls before 2.5.2, calls from other apps, and cached searches are
   not represented. The NAVER Cloud console remains authoritative.
8. Provide an `Open exact usage in NAVER Cloud` action.
9. Do not request, store, or transmit Ncloud IAM Access Key/Secret Key for this
   feature.

## Expected Interpretation

If one prompt causes six NAVER tool calls, the local meter increases by six. If
the model reuses one cached query, that cache hit adds zero. A failed HTTP
response is recorded in both total and failed counts because NAVER's console
also provides success/failure call-volume views; exact billing treatment remains
the provider's authority.

## Verification

- KST day-boundary tests cover 23:59:59 and 00:00:00.
- Daily and monthly aggregation tests cover successful and failed responses.
- HTTP client tests verify one callback per received response and ensure query
  text is not exposed to the usage listener.
- Research Manager integration tests verify one API HUB response increments the
  counter and a cache hit does not.
- Settings migration `23 -> 24` preserves existing settings and any existing
  counters.
- No authentication key, query text, article content, or response body is stored
  in the usage record.

## Official Sources

- [NAVER API HUB overview and call-limit FAQ](https://guide.ncloud-docs.com/docs/apihub-overview)
- [NAVER API HUB usage statistics](https://guide.ncloud-docs.com/docs/apihub-usagestatistics)
- [NAVER API HUB application and usage management](https://guide.ncloud-docs.com/docs/apihub-application)
- [NAVER API HUB API overview](https://api.ncloud-docs.com/docs/naver-api-hub-overview)
- [Ncloud API authentication and security boundary](https://api.ncloud-docs.com/docs/common-ncpapi)

## Known Unknowns

- NAVER may later publish a supported usage-reading API or quota response
  headers. If so, exact remote synchronization can be reconsidered with a
  least-privilege credential.
- Dropbox or Obsidian Sync conflicts can make local counters approximate when
  multiple computers write the same plugin settings concurrently.
- Provider-side handling of failed authenticated calls is not inferred as a
  billing rule; the console remains authoritative.

## Secret Handling

No secrets were recorded in this report or in usage telemetry.
