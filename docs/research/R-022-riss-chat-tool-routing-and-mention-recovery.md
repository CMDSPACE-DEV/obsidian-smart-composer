# R-022: RISS Chat Tool Routing And Mention Recovery

## Status

- Verified: 2026-07-27
- Implemented target: Smart Composer 2.5.5
- Mandatory for future Research Connections routing and mention changes

## Trigger

The RISS connection test returned live records after the 2.5.3 protocol fix,
but chat requests such as `riss 를 호출해서 ... 논문을 찾아봐` did not call
`research_riss_search`. Typing an `@RISS` instruction also appeared to have no
effect, and the model correctly reported that no RISS tool was present in the
request.

## Verified Diagnosis

The public RISS endpoint and adapter were not the failing layer.

1. The installed source was enabled and had a successful connection-test
   timestamp.
2. Research routing was `auto`, and chat tools were enabled.
3. The persisted RISS source policy was still `explicit-only`, inherited from
   an earlier settings version.
4. The latest four saved reproductions contained only the automatic
   `current-file` mention. None contained a serialized
   `research-source:riss` mention.
5. None of those conversations contained a tool call. Therefore
   `research_riss_search` was never exposed to the model.
6. The `@` picker code already included enabled research sources and the
   mention serializer already preserved `research-source`, but routing relied
   entirely on either a successfully selected mention chip or an
   auto-eligible source.

## 2.5.5 Product Decision

1. Treat a typed source identifier, short name, or full name as an explicit
   source request. This includes `RISS`, `RISS를`, `@RISS`, and
   `@RISS Linked Data`.
2. Preserve normal source boundaries: a named source must still be enabled,
   and Research routing `off` still disables the manager.
3. Continue supporting the structured `research-source:riss` mention chip.
   Text recognition is a recovery path, not a replacement for serialized
   mentions.
4. Migrate legacy RISS policies from `explicit-only` to `allow`. Preserve an
   intentional `off` policy.
5. Preserve every other RISS setting, connection-test timestamp, and every
   other research source.

## Regression Coverage

- The `@` picker returns `RISS Linked Data` for a `riss` query.
- A selected research mention survives serialization and deserialization.
- `RISS를 호출해서 ...` routes to RISS even when a legacy fixture says
  `explicit-only`.
- Literal `@RISS Linked Data` text routes to RISS even if the user did not
  commit the autocomplete item.
- The routed local tool definition is exactly `research_riss_search`.
- Settings migration 25 to 26 changes RISS `explicit-only` to `allow`, keeps
  `off`, and preserves source options and test metadata.

## Scope Boundary

- This fix decides whether the RISS tool reaches the model. It does not change
  the SPARQL query, XML parsing, title-only discovery boundary, or RISS
  one-minute server timeout documented in R-020.
- Generic research requests may still select only the configured bounded
  number of Auto sources. Naming RISS directly always takes the explicit
  route.

## Secret Handling

The diagnosis inspected only sanitized booleans, routing modes, mention types,
tool names, and timestamps. No API key, OAuth token, MCP secret, private note
content, or full chat body was recorded.
