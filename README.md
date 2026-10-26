# pi-retry

A [pi](https://github.com/earendil-works/pi) extension that retries failed LLM responses — automatically for transient `aborted` streaming errors, manually via `/retry` or `alt+r`.

Minimal rewrite of [pi-retry](https://github.com/georgebashi/pi-retry) (~45 lines) built on pi's `agent_before_settle` boundary API.

## Features

- **Auto-retry**: when a run settles with an error whose message contains `aborted` (e.g. an upstream proxy/gateway killing the stream), pi commits a hidden `custom_message` entry and continues for one more turn — up to 3 attempts. The retry runs *after* pi's own retry/compaction decisions, so it never double-retries errors pi already handles (rate limits, 5xx, etc.).
- **`/retry` command**: re-invoke the LLM after any errored or aborted response, including ESC cancellations.
- **`alt+r`**: same as `/retry`, bound as an editor shortcut — it only fires while the editor has input focus, so modal dialogs and selectors are unaffected.
- State is tracked per session and resets on `session_start`.

## Installation

```bash
pi install npm:@aac6fef/pi-retry
```

Or from a local checkout:

```bash
pi install /path/to/pi-retry
```

## How it works

`agent_before_settle` fires once a run is about to settle, after pi's own recovery has run its course. If `outcome` is `"error"` and the last assistant message's `errorMessage` matches `/aborted/i`, the handler returns:

```ts
{ entries: [{ type: "custom_message", customType: "pi-retry", content: "…try again.", display: false }], continue: true }
```

pi commits the entry (making the context end on a user-role message so `canContinue` holds), then runs one more turn. The trigger text is model-visible — an honest instruction rather than a hidden message that needs filtering. The failed assistant message is stripped from model context by pi's own `transform-messages`, so the model restarts from the last user prompt.

Optional exponential backoff can be restored by uncommenting one line in `index.ts` (ESC still cancels the wait).

## Notes

- `e.outcome === "aborted"` marks the last response as retryable for manual retry only — user cancels are never auto-retried.
- No logging; add `appendFileSync` in the `agent_before_settle` handler if you need a record.
