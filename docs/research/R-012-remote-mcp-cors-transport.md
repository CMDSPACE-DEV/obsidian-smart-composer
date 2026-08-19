# R-012: Remote MCP CORS Failure And Desktop Transport Correction

> [!IMPORTANT]
> **Status: Verified live-server diagnosis and implemented fix / Mandatory
> planning input**
>
> This report records the Smart Composer 2.3.2 correction for remote MCP
> servers that are reachable but cannot satisfy browser CORS preflight for
> standard MCP request headers.

## 1. Incident

On 2026-07-26, Smart Composer 2.3.0 was tested against a Korean legal MCP
Streamable HTTP endpoint. The saved connection had the expected shape:

```text
https://mcp.gomdori.app/law?oc=[redacted]
transport: streamable-http
authentication: none
```

The connection UI reported:

```text
Failed to connect to Korean Law MCP: Failed to fetch
```

The credential value was never printed or added to source control.

## 2. Live Diagnosis

The endpoint itself was healthy:

- DNS resolution and TCP 443 succeeded.
- CORS `OPTIONS` returned `200 OK`.
- A direct MCP `initialize` POST returned `200 OK`.
- `Access-Control-Allow-Origin` was `*`.

The preflight response allowed:

```text
Content-Type, mcp-session-id, last-event-id
```

It did not allow:

```text
mcp-protocol-version
```

The MCP transport specification requires clients to send
`MCP-Protocol-Version` on requests after initialization. The TypeScript SDK
correctly adds that header. Chromium therefore rejected the renderer
`fetch()` request during CORS preflight and exposed only the generic
`Failed to fetch` error.

### 2.1 Obsidian bundle follow-up

The first 2.3.1 adapter passed Node tests but failed in the installed Obsidian
bundle with:

```text
t.on is not a function
```

The production esbuild target defaults to `browser`. Importing the
`node-fetch` package root therefore selected its `browser.js` export instead
of `lib/index.js`. That export delegates to Chromium `fetch()` and returns a
Web `ReadableStream`; the adapter then incorrectly treated it as a Node
stream and called `.on()`.

The production metafile confirmed this package-resolution mismatch. This was
both a stream-type error and evidence that the intended CORS bypass had not
yet reached the installed bundle.

Primary references:

- [MCP Streamable HTTP transport and protocol-version header](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Electron networking and fetch behavior](https://www.electronjs.org/docs/latest/api/net)

## 3. Implemented Correction

Remote desktop MCP connections now use `createDesktopMcpFetch()`:

```text
MCP SDK request
  -> Node HTTP fetch (no browser CORS enforcement)
  -> Node response stream
  -> Web ReadableStream adapter
  -> standard Web Response returned to MCP SDK
```

The adapter is supplied to both Streamable HTTP and legacy SSE transports.
It preserves:

- request method, headers, body, redirect mode, and abort signal;
- JSON and OAuth form requests;
- long-lived SSE response streaming;
- existing bearer and OAuth request headers.

The runtime import explicitly targets `node-fetch/lib/index.js`, preventing
the browser-targeted build from substituting `node-fetch/browser.js`.
Response normalization accepts both Node streams and already-compatible Web
streams, using runtime capability checks rather than assuming one stream
implementation.

The adapter is only reached through `McpManager`, which remains disabled when
Obsidian is not running on desktop.

Files:

- `src/core/mcp/desktopFetch.ts`
- `src/core/mcp/desktopFetch.test.ts`
- `src/core/mcp/mcpManager.ts`

`node-fetch` 2.7.0 is now an explicit dependency instead of an undeclared
transitive dependency. Its Node response stream is converted to the Web stream
contract required by MCP SDK 1.29.0.

## 4. Verification

Automated tests verify that:

- `mcp-protocol-version` reaches the server without an `OPTIONS` preflight;
- request bodies remain intact;
- SSE bodies support `pipeThrough()` as a Web stream.

The full suite after the change:

```text
test suites: 63 passed
tests: 417 passed
type check: passed
Prettier and ESLint: passed
production build: passed
production main.js: 5,029,325 bytes
bundle budget: passed (<= 5.2 MiB)
```

A live connection using an isolated bundle built with the same browser target
as `main.js` and the stored, redacted Korean Law endpoint completed:

```text
initialize: succeeded
tools/list: succeeded
tools discovered: 10
```

The discovered capabilities included law search, law text, annex, legal
research and analysis, and court-decision search/read tools.

The production metafile contained:

```text
node_modules/node-fetch/lib/index.js
```

and did not contain `node_modules/node-fetch/browser.js`.

`check-bundle-budget.mjs` now enforces this resolution on every production
build so a future package-root import cannot silently restore the browser
transport.

## 5. Boundary

The live test proves the transport and tool-discovery path outside the
Obsidian renderer. The final release smoke test is to restart Obsidian, press
**Connect and scan tools**, review the ten schemas, and invoke one read-only
legal search from chat. No destructive legal or vault action is needed for
that smoke test.

Server operators should still add `mcp-protocol-version` to
`Access-Control-Allow-Headers`; Smart Composer's desktop adapter provides
compatibility rather than redefining the MCP or CORS contracts.
