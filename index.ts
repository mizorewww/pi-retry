import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * pi-retry: auto-retry transient "aborted" streaming errors + manual retry.
 *
 * Everything runs at `agent_before_settle`, which fires only after pi's own
 * retry/compaction decisions — a settled error means built-in recovery already
 * gave up, so there's no overlap to guard against. Returning a custom_message
 * entry plus `continue: true` makes pi commit the entry and run one more turn.
 *
 * The trigger is an honest model-facing instruction (hidden from the TUI via
 * `display: false`), so no context cleanup is needed. Errored/aborted assistant
 * messages are stripped from model context by pi's own transform-messages, so
 * from the model's view the last user prompt is simply still unanswered.
 *
 * Manual retry (/retry, alt+r) triggers the same turn whenever the session is
 * idle and has a user prompt — including restored sessions and completed
 * turns — so it always re-sends the last request upstream rather than
 * depending on in-memory failure state.
 */

const MAX_RETRIES = 3;
const TRIGGER = {
  customType: "pi-retry",
  content: "Please answer the last request again.",
  display: false,
};

export default function (pi: ExtensionAPI) {
  let attempt = 0;

  pi.on("agent_before_settle", async (e, ctx) => {
    if (e.outcome !== "error") {
      attempt = 0;
      return;
    }

    const last = [...e.context.contextMessages]
      .reverse()
      .find((m) => m.role === "assistant") as { errorMessage?: string } | undefined;
    if (!/aborted/i.test(last?.errorMessage ?? "")) return;

    if (++attempt > MAX_RETRIES) {
      attempt = 0;
      ctx.ui.notify(`Retry exhausted after ${MAX_RETRIES} attempts.`, "error");
      return;
    }

    ctx.ui.notify(`Transient error, retrying (${attempt}/${MAX_RETRIES})…`, "info");
    // Optional backoff (ESC during the wait still cancels the continuation):
    // await new Promise((r) => setTimeout(r, 2000 * attempt));
    return { entries: [{ type: "custom_message", ...TRIGGER }], continue: true };
  });

  pi.on("session_start", () => {
    attempt = 0;
  });

  // Manual retry just runs a fresh turn on the current context: pi strips
  // errored/aborted assistant entries, so the model re-answers the last user
  // prompt — i.e. the request is sent upstream again. This works on errored,
  // aborted AND completed turns, including sessions restored from disk where
  // no in-memory failure state exists.
  const hasRequest = (ctx: ExtensionContext) =>
    ctx.sessionManager
      .getEntries()
      .some((e) => e.type === "message" && e.message.role === "user");

  const manual = (ctx: ExtensionContext, notify: boolean) => {
    if (!ctx.isIdle()) return;
    if (!hasRequest(ctx)) {
      if (notify) ctx.ui.notify("Nothing to retry.", "warning");
      return;
    }
    pi.sendMessage(TRIGGER, { triggerTurn: true });
  };

  pi.registerCommand("retry", {
    description: "Send the last request again",
    handler: async (_args, ctx) => manual(ctx, true),
  });

  // registerShortcut only fires while the default editor handles input, so
  // modal/selector dialogs are unaffected — no focus detection needed.
  pi.registerShortcut("alt+r", {
    description: "Send the last request again",
    handler: (ctx) => manual(ctx, false),
  });
}
