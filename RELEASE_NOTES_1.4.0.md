# Smart_composer_Achmage v1.4.0

## Plan model updates

- Adds GPT-5.6 Sol, Terra, and Luna to OpenAI Plan connections.
- Adds independent GPT-5.6 reasoning effort selection: `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Adds Claude Sonnet 5 with Adaptive Thinking, effort selection, and optional summarized thinking display.
- Adds a compact chat-input effort selector that always shows and quickly changes the selected GPT-5.6 or Sonnet 5 reasoning level.
- Migrates the selected gpt-5.5 Plan model to GPT-5.6 Sol and Claude Sonnet 4.6 Plan model to Claude Sonnet 5.
- Keeps API-key model catalogs unchanged.

## Reliability changes

- Preserves provider reasoning metadata across tool-call continuations.
- Applies chat setting changes immediately while serializing disk saves so rapid model or effort changes retain their final order.
- Explicitly disables high-cost reasoning for internal RAG requests where appropriate.
- Reports unsupported Plan models or reasoning settings instead of silently falling back to another model.
- Improves Plan OAuth refresh and redacted HTTP error reporting.

## Before installing

Back up the existing Smart Composer plugin folder and its `data.json`, then install `main.js`, `manifest.json`, and `styles.css` together.

OpenAI and Claude Plan connections are experimental integrations built on subscription authentication and private provider backends. Availability depends on the account and may change without notice. Anthropic recommends API authentication for third-party tools.
