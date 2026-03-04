# Tools Parity Matrix

This matrix tracks Talos parity against OpenClaw tool semantics.

Parity requires matching:

- input parameters and aliases
- config/default precedence
- runtime behavior (including edge cases)
- output shape and detail fields
- error codes and common error messages

## Web Tools

- [x] `web_search`: provider selection parity (Brave/Perplexity/Gemini/Grok/Kimi)
- [x] `web_search`: provider auto-detect precedence parity
- [x] `web_search`: full locale/freshness behavior parity
- [x] `web_search`: output/detail shape parity
- [x] `web_fetch`: readability extraction parity
- [x] `web_fetch`: Firecrawl fallback parity
- [x] `web_fetch`: redirect/response caps and truncation semantics parity
- [x] `web_fetch`: SSRF policy parity (initial + redirect destinations)
- [x] `web_fetch`: output/detail shape parity

## Media Tools

- [x] `image`: model resolution and fallback parity
- [x] `image`: input normalization and policy guards parity
- [x] `pdf`: native-provider mode parity
- [x] `pdf`: extraction fallback mode parity
- [x] `pdf`: pages/max-bytes/max-items semantics parity
- [x] `pdf`: output/detail shape parity
- [x] `pdf`: registration/exposure gating parity

## Session Orchestration Tools

- [x] `sessions_list`: visibility guard semantics parity
- [x] `sessions_list`: kinds/filter/messageLimit behavior parity
- [x] `sessions_history`: message filtering behavior parity
- [x] `sessions_send`: policy/visibility constraints parity
- [x] `sessions_spawn`: runtime/mode/sandbox constraints parity
- [x] `session_status`: metadata/detail shape parity

## LLM Task Tool

- [x] `llm_task`/`llm-task`: parameter and alias parity
- [x] `llm_task`/`llm-task`: model/auth resolution precedence parity
- [x] `llm_task`/`llm-task`: allowed-model enforcement parity
- [x] `llm_task`/`llm-task`: schema validation semantics parity
- [x] `llm_task`/`llm-task`: output/detail shape parity

## Browser and Canvas Tools

- [x] `browser`: action surface parity
- [x] `browser`: action parameter validation parity
- [x] `browser`: output/detail shape parity
- [x] `browser`: target/profile routing semantics parity
- [x] `canvas`: action surface parity
- [x] `canvas`: action parameter validation parity
- [x] `canvas`: output/detail shape parity

## Global Tool Runtime Parity

- [x] allow/deny policy behavior parity across all tools
- [x] timeout/cancellation semantics parity
- [x] tool event lifecycle parity
