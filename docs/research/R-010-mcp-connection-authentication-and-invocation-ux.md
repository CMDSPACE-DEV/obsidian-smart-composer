# R-010: Beginner-Safe MCP Connection, Authentication, and Chat Invocation UX

> [!IMPORTANT]
> **Status: Verified source and official-product investigation / Mandatory
> planning input**
>
> This report records the current Smart Composer 2.1.2 MCP implementation,
> compares it with the July 25, 2026 ChatGPT and Claude connection flows, and
> defines a bounded product architecture for beginner-safe remote MCP setup and
> invocation. The feature described here is not implemented yet.

## 1. Executive Summary

The current Smart Composer MCP form is not merely an unfriendly version of the
modern ChatGPT or Claude form. It configures a different and much narrower
connection model:

```text
current Smart Composer
  -> local desktop process only
  -> stdio transport only
  -> command, arguments, and environment variables
  -> raw JSON entered by the user

modern ChatGPT and Claude
  -> remote MCP endpoint
  -> URL-first setup
  -> authentication discovery or a small authentication choice
  -> browser OAuth when required
  -> tool scan and permission review
```

Therefore, replacing the JSON textarea with ordinary inputs would improve the
surface but would not deliver the workflow the user is asking for. Smart
Composer needs a remote MCP client path, an authentication lifecycle, secure
credential storage, tool discovery, and a prompt-scoped invocation model.

The recommended product shape is:

```text
Settings > Connections

Add connection
  -> Remote MCP (default)
       Name
       Server URL
       Authentication: Automatic
       Connect and scan tools
       Review permissions
       Save

  -> Local command (Advanced)
       Command
       Arguments
       Environment variables / secret references
       Test and scan tools
       Save
```

The recommended chat behavior is:

```text
natural language
  -> default; Smart Composer chooses from enabled relevant connections

@Connection
  -> explicitly scopes one prompt to an app/server
  -> does not directly execute a low-level tool

/tools or composer tool button
  -> opens connection and tool-access controls

approval card
  -> Allow once / Allow for this chat / Always allow where safe / Reject
```

This preserves the existing meaning of `@` as an entity reference while
extending the picker with a clearly separated **Apps and tools** section. It
also preserves `/` for commands rather than making beginners memorize raw MCP
tool names.

The current request-bound MCP lifecycle remains correct for tools whose result
is needed to form the current answer. R-006's separate background-MCP work is
not silently folded into this setup project.

## 2. Research Questions

This investigation answers:

1. What does Smart Composer currently support?
2. What do the current ChatGPT and Claude web experiences actually ask users
   to enter?
3. What transport and OAuth requirements sit behind those simple forms?
4. How should Smart Composer expose remote and local MCP without requiring
   JSON?
5. Should chat invocation use natural language, `@`, `/`, the existing tools
   button, or a combination?
6. How can tool discovery avoid consuming excessive context and startup time?
7. Which credentials and permission decisions may be persisted safely?
8. Which parts remain unverified and must block release claims?

## 3. Scope and Evidence

### Verified in repository source

- Current MCP settings schema and migration boundary.
- Current JSON-based add/edit form.
- Current local `stdio` transport and desktop-only guard.
- Current tool discovery, naming, caching, execution, and cancellation.
- Current per-tool and per-conversation approval behavior.
- Current chat composer tools control and lazy manager initialization.
- Current provider request behavior that exposes every enabled MCP tool.
- Current first-text-block-only tool-result handling.
- Existing localhost OAuth callback-server precedent.
- Installed MCP SDK transport and OAuth type support.
- R-006 request-bound versus background task boundary.
- R-008 lazy-loading and 5.2 MiB bundle gate.
- R-009 vault-reference `@` semantics.

### Verified in official documentation

- Current ChatGPT custom MCP app creation, tool scanning, OAuth, approval,
  prompt invocation, and frozen action-snapshot behavior.
- Current Claude custom connector creation, OAuth advanced settings,
  per-conversation connection toggles, `/` menu, and tool-access modes.
- MCP Streamable HTTP, legacy SSE compatibility, and `stdio` boundaries.
- MCP OAuth 2.1, PKCE, discovery, redirect, and secure-storage requirements.
- Current TypeScript SDK remote transport and OAuth-provider APIs.

### Not live-tested in this investigation

- ChatGPT or Claude account UI pixel measurements.
- A remote MCP connection from the current plugin.
- OAuth discovery, Dynamic Client Registration, or token refresh in Obsidian.
- Electron `safeStorage`, an OS keychain, or another credential backend inside
  the user's Obsidian runtime.
- Remote MCP in Obsidian mobile.
- A tool catalog with dozens of servers in the user's vault.
- Prompt-scoped `@Connection` chips in the current Lexical composer.
- Tool-list change review and snapshot migration.

These are release gates, not findings.

## 4. Baseline

| Field | Value |
| --- | --- |
| Repository | `laguna821/obsidian_smart_composer_Achmage` |
| Source baseline branch | `codex/2.2-inline-reference-research` |
| Source baseline commit | `ee36a362d07d2c2360daf02fee84ee2e7dda48d9` |
| Manifest/package candidate | `2.1.2` |
| Settings schema | `20` |
| Installed MCP SDK | `@modelcontextprotocol/sdk@1.25.2` |
| Declared MCP SDK range | `^1.9.0` |
| Current stable 1.x SDK observed | `1.29.0` |
| Minimum Obsidian | `1.10.0` |

Relevant mandatory reports:

- **R-004**: current `@file`, `@folder`, and vault mention semantics.
- **R-005**: chat popovers, keyboard behavior, accessibility, and dual-skin
  visual requirements.
- **R-006**: request-bound MCP calls, future detached MCP work, approvals,
  cancellation, and secret-free task persistence.
- **R-007**: current implementation boundaries and real-Obsidian release gates.
- **R-008**: lazy MCP initialization, startup behavior, and 5.2 MiB production
  bundle budget.
- **R-009**: `@` as a typed entity picker and the requirement to avoid
  duplicating reference contracts.

## 5. Current Smart Composer MCP Behavior

### 5.1 The settings schema represents only local commands

`src/types/mcp.types.ts` accepts:

```ts
{
  command: string
  args?: string[]
  env?: Record<string, string>
}
```

There is no discriminant for transport and no field for:

- remote URL;
- Streamable HTTP;
- legacy HTTP/SSE;
- authentication mode;
- OAuth state;
- bearer token reference;
- client ID or client secret reference;
- protocol version;
- last successful tool scan;
- tool-definition snapshot;
- connection trust metadata.

The current `env` values are ordinary strings inside plugin settings. An API
token entered there can therefore be serialized with normal plugin data.

That is especially important for this project because the active vault is
Dropbox-backed. A credential stored in the plugin's normal `data.json` may be
synced to every vault device. The new design must separate syncable connection
metadata from device-local secrets.

### 5.2 The add/edit form makes the user author JSON

`src/components/settings/modals/McpServerFormModal.tsx` exposes:

- `Name`;
- one raw `Parameters` textarea;
- an example containing `command`, `args`, and `env`;
- strict JSON and Zod validation;
- `Save` and `Cancel`.

This creates four beginner-facing failure modes:

1. JSON punctuation and quoting errors.
2. Confusion between executable, package, argument, and environment variable.
3. Accidental plaintext credential persistence.
4. No ability to paste the remote MCP URL supplied by most modern services.

The UI also cannot discover whether authentication is needed or show the tools
before saving.

### 5.3 The runtime is `stdio` only

`src/core/mcp/mcpManager.ts` dynamically imports:

```ts
Client
StdioClientTransport
```

It then:

1. loads the desktop shell environment;
2. launches each configured local command;
3. merges configured environment variables;
4. connects through stdin/stdout;
5. calls `listTools()`.

The manager is globally disabled when `Platform.isDesktop` is false because
the current path requires Node process execution.

There is no `StreamableHTTPClientTransport`, `SSEClientTransport`, or OAuth
provider in current Smart Composer source.

### 5.4 Existing tool approval is a useful foundation

The current system already has valuable controls:

- per-tool `disabled`;
- per-tool `allowAutoExecution`;
- transient `Allow for this chat`;
- default `PendingApproval`;
- `Allow`, `Reject`, and `Abort`;
- one abort controller per active tool call;
- server-prefixed tool names such as `server__tool`.

`src/components/chat-view/ToolMessage.tsx` exposes:

```text
Allow
  - Always allow this tool
  - Allow for this chat

Reject
Abort
```

This is a better starting point than replacing the entire tool-call UI. The
next design should make risk and data flow clearer while preserving these
scopes.

### 5.5 All enabled tools are exposed to the model

`src/utils/chat/responseGenerator.ts` calls
`mcpManager.listAvailableTools()` when tools are enabled. The returned schemas
are passed into the current model request.

This is acceptable for a small local setup, but it does not scale to a
beginner-friendly connector library:

- every tool schema consumes context;
- tool descriptions can distract routing;
- initialization and `listTools()` latency grows;
- one global tools toggle does not express prompt-level intent;
- the user cannot pin one server for a specific request.

This makes tool-loading policy part of the UX, not only a performance
optimization.

### 5.6 Tool-result support is narrower than MCP

`McpManager.callTool()` currently:

1. rejects an empty `content` array;
2. inspects only `content[0]`;
3. accepts only a first block with `type === 'text'`;
4. errors for other result types.

Remote servers may return multiple text blocks, images, resources, or other
structured content. Connection setup must report such capabilities honestly;
the implementation must not claim full remote MCP compatibility while silently
discarding them.

### 5.7 Lazy loading must be preserved

The current composer wrench opens `ToolsControl`. Only then does Smart
Composer initialize `McpManager` and count available tools.

R-008 explicitly protects this boundary. Remote transports, OAuth code, and
credential adapters must remain behind dynamic imports or an equivalent lazy
boundary so MCP does not regress ordinary chat startup or the 5.2 MiB release
budget.

### 5.8 A small copy defect should be corrected

The current settings heading says:

```text
MCP (Model Context Pool)
```

The correct name is:

```text
MCP (Model Context Protocol)
```

For beginner-facing UI, the recommended visible section name is
**Connections**, with `Model Context Protocol (MCP)` in supporting copy.

## 6. ChatGPT Web Pattern, July 25, 2026

OpenAI now groups connectors under **Apps**. That product naming should not be
copied blindly, but the interaction pattern is relevant.

### 6.1 Configuration flow

The official ChatGPT developer-mode guide describes:

```text
Settings or Workspace settings
  -> Apps
  -> Create
  -> provide MCP endpoint and metadata
  -> choose authentication mechanism
  -> Scan Tools
  -> complete OAuth when requested
  -> Create
```

The crucial UX property is progressive disclosure:

- endpoint first;
- authentication as a choice, not handwritten headers;
- tool discovery before final creation;
- OAuth in a browser;
- permissions and actions reviewed after discovery.

ChatGPT can connect only to remote servers directly. A private or local server
requires its separate Secure MCP Tunnel. Smart Composer is a local desktop
client, so it does not share that cloud-network constraint; it can potentially
reach `localhost` and private-network endpoints directly.

Source:
[OpenAI: Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)

### 6.2 Invocation flow

Official ChatGPT documentation describes:

- selecting an app from the chat tools menu;
- referring to an app in the prompt;
- `@` mentions for connected apps;
- `+` then `More` as a picker;
- more than one app in one prompt.

This is app-level selection. It does not require the user to know a raw MCP
tool identifier.

Source:
[OpenAI: Apps in ChatGPT](https://help.openai.com/en/articles/11487775-apps-in-chatgpt)

### 6.3 Approval and change review

The current ChatGPT flow:

- asks for confirmation based on app permissions and action context;
- lets administrators configure actions;
- does not silently enable newly discovered actions;
- retains a frozen snapshot of approved tools;
- shows action-definition changes for review.

The snapshot behavior is particularly valuable for Smart Composer. A trusted
server URL can later change its tool descriptions or add a destructive action.
Connection trust must not imply automatic trust in every future schema.

### 6.4 API design evidence

OpenAI's Responses API MCP tool supports:

- remote `server_url`;
- authorization supplied separately from the URL;
- `allowed_tools`;
- per-tool or global `require_approval`;
- multiple MCP calls;
- deferred tool loading.

Smart Composer should not become OpenAI-only by directly adopting this hosted
tool as its sole MCP architecture. The concepts are still useful for a
provider-neutral local client:

- server-level filtering;
- prompt-level allowed tools;
- approval policy;
- deferred loading.

Source:
[OpenAI API: MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## 7. Claude Web Pattern, July 25, 2026

### 7.1 Configuration flow

Claude's current custom remote connector flow is even smaller:

```text
Customize
  -> Connectors
  -> Add custom connector
  -> Name
  -> URL
  -> optional Advanced settings
       OAuth Client ID
       OAuth Client Secret
  -> Add
  -> Connect and authorize
```

The default assumes the server and OAuth metadata can supply most technical
details. Manual client credentials appear only when automatic registration or
pre-registration is unavailable.

Source:
[Claude: Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

### 7.2 Invocation flow

Claude exposes connectors through:

- natural-language automatic suggestion;
- the lower-left `+` menu;
- `/` to open that menu;
- per-conversation connector toggles;
- direct reference to the connected service in a prompt.

Again, `/` opens a command and selection surface. It is not primarily a syntax
for invoking a raw tool schema.

Source:
[Claude: Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)

### 7.3 Tool-loading modes

Claude documents three per-conversation modes:

| Mode | Behavior |
| --- | --- |
| Auto | Dynamically choose relevant connectors |
| Always available | Load every configured connector up front |
| On demand | Search for a connector, then load only relevant tools |

Claude recommends `Auto` for most users and `On demand` when many connectors
consume conversation space.

This directly validates the need to replace Smart Composer's single
all-tools-or-no-tools behavior with a loading policy.

Source:
[Claude: Manage Claude's tool access](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access)

### 7.4 Permission model

Claude groups connector permissions into read-only and write/delete categories
and supports:

- `Always allow`;
- `Needs approval`;
- `Blocked`.

It also warns users to connect only trusted servers and to treat unexpected
tool changes and prompt injection as real risks.

Smart Composer can adopt the same comprehensible categories without pretending
that server-supplied annotations are a security proof.

## 8. MCP Transport and Authentication Requirements

### 8.1 Transport types are distinct

The recommended settings model must distinguish:

```text
stdio
  local child process
  desktop only
  command + args + env

streamable-http
  remote or local URL
  current preferred HTTP transport
  optional server event stream

sse-legacy
  compatibility fallback
  not the default new-connection choice
```

MCP Streamable HTTP replaced the earlier HTTP+SSE transport. A compatible
client can try Streamable HTTP first and fall back to legacy SSE only when the
endpoint indicates the old behavior.

Source:
[MCP specification: Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

### 8.2 OAuth is a lifecycle, not a token field

For remote HTTP servers, MCP authorization uses OAuth conventions that include:

1. initial connection and `401` challenge;
2. protected-resource metadata discovery;
3. authorization-server metadata discovery;
4. pre-registered client metadata, client metadata documents, or Dynamic
   Client Registration where supported;
5. manual client ID and secret only when automatic paths are unavailable;
6. Authorization Code flow with PKCE;
7. browser redirect and state verification;
8. token exchange;
9. secure token persistence;
10. refresh, expiry, invalidation, and reconnect.

The current MCP specification requires PKCE and permits only `localhost` or
HTTPS redirect URIs.

Sources:

- [MCP: Understanding Authorization](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [MCP specification: Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP: Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)

### 8.3 The installed SDK already contains the main primitives

The installed `@modelcontextprotocol/sdk@1.25.2` includes:

- `StreamableHTTPClientTransport`;
- deprecated-compatible `SSEClientTransport`;
- `OAuthClientProvider`;
- token refresh behavior;
- `UnauthorizedError`;
- `finishAuth(code)`.

The SDK's remote transport explicitly supports:

1. loading an existing access token;
2. refreshing an expired token;
3. redirecting to authorization when needed;
4. finishing authorization with the callback code;
5. reconnecting after auth.

This means the first implementation does not require a move to an unstable
2.x beta merely to gain remote OAuth. Upgrading from the installed 1.25.2 to a
current stable 1.x should be evaluated separately with bundle and regression
tests.

Source:
[MCP TypeScript SDK client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)

## 9. Product Information Architecture

### 9.1 Rename the settings section for beginners

Recommended:

```text
Connections
Connect Smart Composer to tools and services using MCP.
```

Secondary label:

```text
Model Context Protocol (MCP)
```

Do not lead with protocol vocabulary or a JSON editor.

### 9.2 Connection list

Each connection row should show:

- icon or deterministic initial;
- display name;
- `Remote` or `Local`;
- connection state;
- authentication state;
- enabled state;
- enabled/total tool count;
- last successful scan time;
- warning badge for changed tools;
- overflow menu for Edit, Reconnect, Review tools, Disable, and Remove.

Recommended states:

```text
Disconnected
Connecting
Authorization required
Waiting for browser authorization
Scanning tools
Connected
Connected with changes
Authentication expired
Unavailable
Error
```

Error text should identify the failed stage:

- endpoint unreachable;
- protocol negotiation failed;
- authorization rejected;
- callback timed out;
- token refresh failed;
- tool scan failed;
- unsupported result capability.

### 9.3 Add Connection entry point

The first choice should be:

```text
Remote MCP
Paste a server URL and connect.
```

The secondary choice should be:

```text
Local command
Run an MCP server on this computer. Advanced.
```

The old JSON form remains only as:

```text
Advanced > Import JSON
```

It should support migration and expert copy/paste, not be the primary editor.

## 10. Remote MCP Setup Wizard

### 10.1 Step 1: Server

Visible fields:

```text
Name
Server URL
```

Behavior:

- accept `https://.../mcp`;
- permit `http://127.0.0.1` and `http://localhost` with a local-only badge;
- reject ordinary insecure remote HTTP by default;
- normalize whitespace but never silently rewrite the host;
- display the exact origin that will receive requests;
- derive a suggested name from server metadata or hostname;
- keep a stable internal ID separate from the editable display name.

Primary action:

```text
Continue
```

### 10.2 Step 2: Authentication

Default:

```text
Automatic (recommended)
Smart Composer will detect whether sign-in is required.
```

Alternative choices:

```text
No authentication
Bearer token
OAuth client details (Advanced)
Custom headers (Expert)
```

For automatic OAuth:

- perform metadata discovery;
- prefer pre-registration/client metadata or DCR;
- open the system browser;
- show requested host and scopes;
- return to Obsidian through a validated callback;
- never ask the user to paste an access token when OAuth works.

For manual client details:

```text
Client ID
Client secret
```

The secret field is optional because local OAuth public clients commonly use
PKCE without a client secret.

### 10.3 Step 3: Connect and Scan Tools

The primary action should be:

```text
Connect and scan tools
```

Visible progress:

```text
Checking endpoint
Detecting protocol
Checking authentication
Waiting for authorization
Connecting
Scanning tools
```

Successful result:

```text
Connected
14 tools discovered
```

Do not save a connection as healthy merely because a URL parsed correctly.

An advanced `Save disconnected` action may exist for offline servers, but it
must carry a truthful warning.

### 10.4 Step 4: Review Access

Group discovered tools into:

```text
Read and search
Create or update
Delete or destructive
Unknown
```

Per group or tool:

```text
Allowed
Ask each time
Blocked
```

Recommended defaults:

| Category | Default |
| --- | --- |
| Read/search | Ask each time for an untrusted server |
| Create/update | Ask each time |
| Delete/destructive | Blocked or always ask |
| Unknown | Ask each time |

After the user has explicitly trusted a read-only tool, the existing
`Allow for this chat` and `Always allow this tool` paths remain useful.

Server-provided MCP annotations may seed categories, but the UI must label them
as server-declared. They are hints, not verified security properties.

### 10.5 Step 5: Save

The summary should show:

- server name and origin;
- transport;
- authentication type;
- number of enabled tools;
- approval policy;
- whether the credential stays on this device;
- whether the connection metadata will sync with the vault.

## 11. Local Command Setup Without JSON

The current `stdio` capability should remain, but move behind **Advanced**.

Structured fields:

```text
Name
Command
Arguments
  [argument row] [+ Add argument]
Environment
  KEY  [secret/value field]  [stored as secret?]
Working directory (optional)
```

Primary action:

```text
Test and scan tools
```

Useful affordances:

- paste an `npx ...` command and parse it into command/argument rows;
- add/remove/reorder arguments;
- mark environment values as secret;
- reveal a secret only after explicit user action;
- import/export JSON under Advanced;
- show the actual executable and arguments before launch;
- warn before executing an untrusted package command.

Legacy settings migrate to `type: 'stdio'` without behavior change.

## 12. Recommended Settings and Runtime Types

A future settings migration should move from implicit `parameters` to a
discriminated connection union:

```ts
type McpConnectionConfig =
  | {
      id: string
      displayName: string
      enabled: boolean
      transport: {
        type: 'stdio'
        command: string
        args?: string[]
        cwd?: string
        env: Record<string, McpValueRef>
      }
      toolOptions: Record<string, McpToolPolicy>
    }
  | {
      id: string
      displayName: string
      enabled: boolean
      transport: {
        type: 'streamable-http'
        url: string
        legacySseFallback: boolean
      }
      auth: McpAuthConfig
      toolOptions: Record<string, McpToolPolicy>
      toolSnapshot?: McpToolSnapshot
    }
```

Credential-bearing values should be references:

```ts
type McpValueRef =
  | { kind: 'plain'; value: string }
  | { kind: 'secret'; secretRef: string }

type McpAuthConfig =
  | { type: 'auto-oauth'; credentialRef?: string }
  | { type: 'none' }
  | { type: 'bearer'; secretRef: string }
  | {
      type: 'oauth-client'
      clientId: string
      clientSecretRef?: string
      credentialRef?: string
    }
```

The exact schema version is an implementation decision. A likely next
migration is `20 -> 21`, but this report does not reserve it.

### 12.1 Separate persistent records

```text
syncable plugin settings
  connection metadata
  URL
  display name
  transport
  tool policies
  tool snapshot hash

device-local secret store
  bearer tokens
  OAuth access/refresh tokens
  client secrets
  secret environment values
  PKCE verifier while authorization is active

ephemeral runtime state
  authorization state
  callback listener
  session IDs
  active transport
  reconnect attempts
```

No token, secret, authorization code, or verifier belongs in chat history,
task records, artifact records, telemetry, or normal logs.

## 13. Secret Storage

### 13.1 Current risk

The current `env: Record<string, string>` lives in normal settings. This is
convenient for local MCP but unsuitable as the default for beginner-facing
remote authentication, especially in a synced vault.

### 13.2 Required abstraction

Introduce:

```ts
interface SecretStore {
  set(ref: string, value: string): Promise<void>
  get(ref: string): Promise<string | null>
  delete(ref: string): Promise<void>
  isAvailable(): Promise<boolean>
}
```

The UI and MCP manager consume `secretRef`; they do not know the storage
implementation.

### 13.3 Unverified backend decision

This investigation found no current `keytar`, Electron `safeStorage`, or
project-specific `SecretStore` dependency. Obsidian exposes Electron on desktop
in practice, but the stability and availability of a secure-storage API inside
the supported Obsidian runtime was not live-tested here.

Therefore:

- do not promise OS-keychain storage yet;
- prototype and live-test a desktop secure backend;
- keep an in-memory/session-only fallback;
- if encrypted persistence is unavailable, state that clearly and require
  reauthentication rather than silently writing plaintext;
- treat each synced computer as a separate authenticated device.

## 14. OAuth Callback Architecture

Smart Composer already has a localhost callback server for Codex Plan login.
That proves a local callback is feasible in the plugin, but the provider-
specific implementation should not be reused as a generic MCP OAuth manager
without extracting and hardening the contract.

Recommended desktop flow:

```text
create random state and PKCE verifier
  -> bind callback to 127.0.0.1
  -> open system browser
  -> verify path, state, and error fields
  -> pass code to StreamableHTTPClientTransport.finishAuth()
  -> exchange and securely store tokens
  -> close callback listener
  -> reconnect and scan tools
```

Requirements:

- bind to loopback, not all interfaces;
- use a cryptographically random state;
- use PKCE S256;
- enforce a short timeout;
- refuse callback state mismatch;
- scrub code, token, query, and headers from logs;
- close the listener on success, failure, cancel, plugin unload, and timeout;
- display the exact authorization host before opening it;
- support refresh and explicit Disconnect.

`registerObsidianProtocolHandler` exists in the Obsidian API and may be useful
for some callback designs. It should remain an investigated alternative rather
than the default because OAuth servers often require pre-registered exact
redirect URIs and may not accept custom URI schemes.

## 15. Chat Invocation UX

### 15.1 Four complementary layers

No single trigger should carry every job.

| Layer | Purpose | Recommended behavior |
| --- | --- | --- |
| Natural language | Beginner default | Model chooses relevant enabled connection |
| `@` | Explicit prompt scope | Attach one or more connection chips |
| `/` | Commands and discovery | Open `/tools`, `/connections`, and mode controls |
| Wrench button | Persistent management | Enable tools, choose access mode, manage connections |

### 15.2 `@` means entity, not raw function

R-004 and R-009 already establish:

```text
@note
@folder
@vault
```

Do not replace this with an MCP-only syntax. Extend the same picker with
sections:

```text
Vault
  note.md
  folder/
  Vault

Apps and tools
  Korean Law
  GitHub
  Notion
```

Selecting a connection creates a chip:

```text
@Korean Law
```

Semantics:

- enable that connection for this prompt;
- prioritize its tools;
- keep its exact tool choice model-driven;
- allow several connection chips in one request;
- store the selected connection IDs in the user-message metadata;
- display the selection truthfully in history.

If a vault item and connection share a name, section labels and icons resolve
the ambiguity.

### 15.3 `/` opens commands

Recommended initial commands:

```text
/tools
/connections
```

They open a command palette or the existing tools popover. They do not execute
an arbitrary tool.

Optional later shortcuts:

```text
/tool-access
/disconnect
```

Avoid generating a slash command for every server and tool. Tool lists change,
names collide, and beginners should not need an API vocabulary.

### 15.4 Natural language remains primary

Examples:

```text
Find the latest Korean statute for this section.
Create a GitHub issue from this note.
Search my Notion project notes and compare them with @Current note.
```

When one enabled connection clearly matches, Auto mode may select it.

When several connections could perform the action:

- show a compact connection chooser;
- do not silently pick a write-capable service;
- preserve the user's selection for that prompt only unless they pin it to the
  conversation.

### 15.5 Composer tools popover

The current wrench control should evolve from:

```text
Use MCP tools
N tools available
Manage MCP servers
```

to:

```text
Tools

Access mode
  Auto
  Always available
  On demand
  Off

This chat
  [toggle] Korean Law
  [toggle] GitHub

Manage connections
```

Keep the existing lazy-open behavior from R-008.

## 16. Tool Loading and Context Budget

### 16.1 Why the current model does not scale

Today, enabling tools can pass every enabled tool definition to the model.
With many servers, this spends context before the user has asked a question.

### 16.2 Recommended modes

#### Auto

Default:

1. include explicitly selected `@Connection` servers;
2. score connection metadata against the user request;
3. load a small relevant tool subset;
4. fall back to a chooser when routing confidence is low.

#### Always available

Expose every enabled tool. This preserves current behavior for a small,
trusted setup and debugging.

#### On demand

Expose one small plugin-local catalog/search tool first:

```text
search_mcp_connections
search_mcp_tools
```

After the model selects a relevant connection or tool, Smart Composer loads
only those schemas and continues the response.

This is analogous to deferred loading but remains provider-neutral.

#### Off

Expose no MCP tools and do not initialize MCP unless the user opens settings.

### 16.3 Provider neutrality

OpenAI's hosted MCP tool can defer loading at the provider layer, but Smart
Composer also supports Claude Plan/API and other providers. The core
architecture should therefore:

- connect to MCP servers client-side;
- normalize discovered tools;
- perform routing in plugin-owned code;
- expose selected tools through each provider's ordinary function-tool
  contract;
- use a provider-native MCP feature only as an optional capability, not the
  universal storage and permission layer.

## 17. Approval UX

### 17.1 Preserve current scopes

Keep:

```text
Allow once
Allow for this chat
Always allow this tool
Reject
Abort
```

### 17.2 Add comprehensible risk context

Before approval, show:

- connection name and verified origin;
- human-readable action;
- read, write, delete, or unknown badge;
- target resource where known;
- concise parameter preview;
- what data will leave the vault;
- whether the result may modify an external service.

### 17.3 Conservative defaults

- Never infer `Always allow` for write/delete tools.
- Do not let a connection-level trust toggle bypass explicit destructive
  policies.
- `Allow for this chat` expires with the conversation.
- A changed tool schema invalidates its prior automatic approval.
- A renamed tool is treated as a new tool.
- New tools are disabled or approval-required until reviewed.

### 17.4 Tool snapshot

Persist a sanitized snapshot:

```ts
type McpToolSnapshot = {
  scannedAt: number
  protocolVersion?: string
  hash: string
  tools: Array<{
    name: string
    description?: string
    inputSchemaHash: string
    annotations?: Record<string, unknown>
  }>
}
```

On reconnect:

```text
same hash
  -> continue

new/removed/changed tool
  -> Connected with changes
  -> show diff
  -> require review
```

Do not persist tool outputs in this snapshot.

## 18. Runtime Architecture

### 18.1 Transport factory

Refactor the connection step behind:

```ts
interface McpTransportFactory {
  connect(config: McpConnectionConfig): Promise<McpConnection>
}
```

Implementations:

```text
StdioMcpTransportFactory
StreamableHttpMcpTransportFactory
LegacySseMcpTransportFactory
```

This prevents remote-auth state from being mixed into local process-spawn
logic.

### 18.2 Per-connection capability

Replace the global mobile `disabled` flag with transport capability:

```text
stdio
  desktop only

remote HTTP
  desktop initially
  mobile only after live validation
```

Remote MCP may be technically possible on mobile, but callback, CORS/network,
background suspension, and credential persistence remain unverified. The first
release should not advertise mobile support.

### 18.3 Request lifecycle

Normal MCP calls remain part of the foreground response when the answer depends
on them:

```text
user prompt
  -> select/load tools
  -> model requests tool
  -> approval if required
  -> call MCP server
  -> return result
  -> model completes answer
```

This preserves R-006.

Long-running independent research remains a separate future adapter:

```text
BackgroundTaskAdapter
MCP Tasks capability negotiation
origin anchoring
independent cancellation
```

Adding a URL form does not make every MCP call detachable.

### 18.4 Tool results

Before claiming full remote MCP support:

- concatenate or render multiple text blocks;
- support images through safe artifact handling;
- represent resource links and embedded resources;
- retain structured content where useful;
- display unsupported types explicitly;
- cap large results and provide a truthful truncation notice;
- sanitize rendered content;
- keep secrets and authorization headers out of error details.

## 19. Visual and Interaction Design

Connection surfaces should use the established R-005 language:

- Hallym Light: quiet web-app connection cards;
- CMDS Dark: compact operator-style connection cards;
- same information hierarchy and control placement;
- 8 px or smaller card radius;
- icon buttons with tooltips;
- no cards nested inside decorative cards;
- no raw protocol dump in the default path;
- stable button and status dimensions;
- keyboard-operable segmented controls and tool rows;
- visible focus;
- screen-reader status announcements;
- reduced-motion support;
- popout `ownerDocument` and portal correctness.

The OAuth waiting state may use the existing subtle animated-border language,
but must also include plain text:

```text
Waiting for browser authorization
```

Animation cannot be the only status signal.

## 20. Recommended User Flows

### 20.1 Beginner adds a no-auth server

```text
Settings > Connections > Add connection
  -> Remote MCP
  -> paste URL
  -> Automatic authentication
  -> Connect and scan tools
  -> 6 tools discovered
  -> review permissions
  -> Save
```

### 20.2 Beginner adds an OAuth server

```text
paste URL
  -> Connect and scan tools
  -> Authorization required
  -> system browser opens
  -> user approves scopes
  -> Obsidian receives callback
  -> tools are scanned
  -> permissions are reviewed
  -> connection saved; secret remains device-local
```

### 20.3 Advanced user adds a local package

```text
Add connection > Local command
  -> Command: npx
  -> Arguments: -y, package-name
  -> Secret environment variable: TOKEN
  -> Test and scan tools
  -> review launch command and tools
  -> Save
```

### 20.4 User invokes one server explicitly

```text
@Korean Law Find the current statute relevant to this paragraph.
```

The chip scopes the prompt. The model chooses the correct search/read tool.

### 20.5 User combines vault and MCP context

```text
@Current note @Korean Law
Check whether the legal claims in this note still match the current statute.
```

The vault mention supplies local context. The connection mention supplies
available external actions. They are distinct typed chips in one picker.

### 20.6 User combines several services

```text
@Notion @GitHub
Find the approved project requirement and create a draft issue.
```

Read/search happens first. The write action receives explicit approval.

## 21. Rejected Simplifications

### Keep raw JSON and add examples

Rejected as the primary UX because it still requires configuration syntax,
stores secrets unsafely, and cannot represent remote OAuth lifecycle.

### Replace the JSON textarea with URL only

Rejected as incomplete. URL parsing alone does not provide discovery, OAuth,
tool scan, permission review, token refresh, or schema-change safety.

### Use `/tool-name` for every MCP tool

Rejected because tool schemas change, names collide, and it exposes protocol
internals to beginners.

### Use `@tool-name` for direct execution

Rejected because `@` already identifies vault entities and should identify
connections at the same semantic level. A mention scopes context/capability; it
does not bypass model routing or approval.

### Auto-run every tool on a connected server

Rejected because connection trust is not equivalent to permission for every
read, write, delete, or future action.

### Move directly to an MCP SDK 2 beta

Rejected as an onboarding prerequisite. The installed stable 1.x SDK already
contains the required transport and OAuth primitives. Any SDK upgrade needs a
separate compatibility and bundle decision.

### Make all MCP work a background task

Rejected by R-006. Many tool results are required before the current answer can
be completed.

## 22. Recommended Delivery Boundary

Treat this as a standalone feature after the inline-reference work, tentatively:

```text
Smart Composer Achmage 2.3.0
MCP Connections
```

The version is advisory, not reserved.

Minimum feature-complete scope:

1. Remote Streamable HTTP transport.
2. Structured no-auth and bearer-token setup.
3. OAuth discovery, PKCE, callback, refresh, and disconnect.
4. Device-local `SecretStore` with no plaintext-token fallback.
5. Structured local-command editor and legacy migration.
6. Connect-and-scan state machine.
7. Tool review, permission categories, and frozen snapshot/hash.
8. Natural-language Auto routing.
9. `@Connection` prompt chips in a sectioned existing mention picker.
10. `/tools` or equivalent command that opens controls.
11. Auto, Always available, On demand, and Off loading modes.
12. Multiple MCP result content blocks or explicit capability limits.
13. R-006 request-bound lifecycle and approval preservation.
14. R-008 lazy-loading and 5.2 MiB budget preservation.

Possible implementation slices:

```text
Slice A
  schemas and migration
  structured local command form
  remote no-auth Streamable HTTP
  connect and tool scan

Slice B
  SecretStore
  bearer token
  OAuth discovery and callback
  refresh and disconnect

Slice C
  tool snapshots and permission review
  Auto/Always/On demand routing
  @Connection and /tools UX

Slice D
  multimodal/resource results
  mobile feasibility
  legacy SSE fallback hardening
```

OAuth and secret storage must not be postponed past a release that advertises
authenticated remote MCP.

## 23. Test Plan

### 23.1 Schema and migration

- Migrate every legacy `{ command, args, env }` server to `stdio`.
- Preserve server IDs, enable state, disabled tools, and auto-execution flags.
- Convert secret-marked environment variables without logging values.
- Keep unknown future fields through a failed or partial migration.
- Roll back settings if migration cannot complete.

### 23.2 Remote transport

- No-auth Streamable HTTP server.
- JSON response and SSE-stream response.
- Session ID lifecycle.
- reconnect with backoff.
- 404/405 legacy SSE negotiation.
- invalid URL and insecure remote HTTP rejection.
- localhost and private-network connection.
- server offline, malformed initialize response, and tool scan timeout.

### 23.3 OAuth

- metadata discovery.
- DCR or supported automatic client registration.
- pre-registered public client.
- manual client ID without secret.
- manual client ID with secret.
- state mismatch rejection.
- PKCE verifier and S256.
- user denial.
- callback timeout and cancel.
- access-token expiry.
- successful refresh-token rotation.
- invalid refresh token and reauthentication.
- plugin unload while authorization is pending.
- no token, code, verifier, or authorization header in logs.

### 23.4 Secret persistence

- Config syncs while token does not.
- Second Dropbox-synced computer shows `Authentication required on this
  device`.
- Remove connection deletes its secret references.
- Secret backend unavailable produces a truthful session-only choice.
- Plugin data, chat history, task records, and artifacts contain no secret
  values.

### 23.5 Tool discovery and permissions

- zero, one, and hundreds of tools.
- read/write/delete/unknown grouping.
- disabled tools never enter provider requests.
- changed schema invalidates prior automatic approval.
- added tool starts disabled or approval-required.
- removed tool disappears without deleting unrelated policies.
- malicious description or annotation renders as text, not executable markup.

### 23.6 Chat invocation

- natural-language Auto selection.
- `@Connection` plus `@file`.
- `@Connection` plus `@folder`.
- two connections in one prompt.
- same-name vault item and connection.
- `/tools` keyboard path.
- per-chat connector toggle.
- ambiguous service chooser.
- `Always available` current-behavior parity.
- `On demand` exposes only catalog tools before selection.

### 23.7 Approval and execution

- Allow once.
- Allow for this chat.
- Always allow trusted read-only tool.
- write action still asks.
- delete action blocked by policy.
- Reject.
- Abort one tool call.
- parallel tool calls with independent terminal states.
- request-bound response continuation after approval.
- plugin reload with no replay of side effects.

### 23.8 Tool results

- multiple text blocks.
- image block.
- embedded and linked resource.
- structured content.
- large output cap and visible truncation.
- unsupported type warning.

### 23.9 UX and compatibility

- Hallym Light and CMDS Dark.
- 320, 400, and 800 px sidebars.
- keyboard-only setup.
- IME and paste in name/URL fields.
- password-manager paste.
- screen-reader status changes.
- reduced motion and forced colors.
- popout windows.
- actual Obsidian desktop smoke test.
- mobile shows a truthful unsupported state until verified.

### 23.10 Performance and release gates

- MCP modules remain lazy before the tools UI opens or a prompt explicitly
  needs MCP.
- ordinary chat startup does not initialize MCP.
- remote connection does not load `shell-env`.
- local `stdio` does not load HTTP OAuth code unnecessarily.
- `npm run type:check`.
- complete tests.
- lint.
- production build.
- `main.js <= 5.2 MiB`.

## 24. Verified Findings

1. Current Smart Composer MCP is local `stdio` only.
2. The current form requires raw JSON.
3. Credentials placed in `env` are represented as normal setting strings.
4. Current MCP is globally disabled on mobile.
5. Current MCP manager already lazy-loads after the tools UI is opened.
6. Current execution already supports once/chat/persistent approval scopes.
7. Current provider path exposes all enabled tools when tools are on.
8. Current result handling supports only the first text content block.
9. ChatGPT's current custom MCP flow uses endpoint, auth choice, tool scan,
   OAuth when needed, then creation.
10. ChatGPT supports app selection/references and multiple apps in one prompt.
11. ChatGPT freezes approved tool definitions and reviews changes.
12. Claude's current custom connector flow uses name, URL, optional client
    credentials, then connection/authentication.
13. Claude exposes connectors through natural language, `+`, and `/`.
14. Claude documents Auto, Always available, and On demand loading modes.
15. MCP's preferred remote transport is Streamable HTTP; older HTTP+SSE is a
    compatibility path.
16. MCP OAuth requires PKCE and secure token storage.
17. The installed SDK already contains remote transport and OAuth provider
    primitives.
18. Current source contains a localhost OAuth callback precedent.
19. No secure credential backend is currently implemented or verified.
20. R-006 requires ordinary answer-dependent MCP calls to remain foreground
    request-bound.

## 25. Open Decisions

- Which desktop secure-storage backend works reliably in the supported
  Obsidian/Electron versions?
- Should a session-only credential fallback ship, or should authenticated MCP
  be unavailable without secure persistence?
- Which OAuth client metadata and callback URL strategy works across the first
  target servers?
- Is legacy SSE automatic fallback enabled by default or only after a user
  confirms it?
- Which local classifier selects tools in Auto mode?
- Is On demand implemented with one catalog function or two separate
  connection/tool search functions?
- Should `@Connection` remain prompt-only or also offer `Pin to chat`?
- Which server/tool annotations are present in the intended Korean Law MCP?
- Which multimodal result types must ship in the first remote release?
- Can remote HTTP and OAuth be supported safely on Obsidian mobile?
- Does the current Plan-provider tool path behave consistently with several
  dynamically loaded MCP schemas?

## 26. Secret and Privacy Statement

No OAuth token, API key, MCP bearer token, client secret, environment secret,
vault note content, account identifier, or private endpoint was read or
recorded during this investigation.

The report uses repository source, installed public package declarations,
existing sanitized research reports, and first-party public documentation.

## 27. Repository Source Index

```text
src/types/mcp.types.ts
src/core/mcp/mcpManager.ts
src/core/mcp/tool-name-utils.ts
src/components/settings/modals/McpServerFormModal.tsx
src/components/settings/sections/McpSection.tsx
src/components/chat-view/chat-input/ToolsControl.tsx
src/components/chat-view/ToolMessage.tsx
src/utils/chat/responseGenerator.ts
src/settings/schema/setting.types.ts
src/settings/schema/migrations/index.ts
src/core/llm/codexAuth.ts
src/components/settings/modals/ConnectOpenAIPlanModal.tsx
node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts
node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts
node_modules/@modelcontextprotocol/sdk/dist/esm/client/sse.d.ts
node_modules/obsidian/obsidian.d.ts
```

## 28. Official Source Index

- [OpenAI: Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
- [OpenAI: Apps in ChatGPT](https://help.openai.com/en/articles/11487775-apps-in-chatgpt)
- [OpenAI API: MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Claude: Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Claude: Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- [Claude: Manage Claude's tool access](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access)
- [MCP: Understanding Authorization](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [MCP: Authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP: Transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP: Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP TypeScript SDK client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)
