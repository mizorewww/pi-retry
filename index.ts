import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
 * the retry resumes from the last user prompt.
 */

const MAX_RETRIES = 3;
const TRIGGER = {
  customType: "pi-retry",
  content: "The previous response was aborted. Please try again.",
  display: false,
};

export default function (pi: ExtensionAPI) {
  let attempt = 0;
  let failed = false;

  pi.on("agent_before_settle", async (e, ctx) => {
    failed = e.outcome !== "completed";
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
    failed = false;
  });

  const manual = () => {
    failed = false;
    pi.sendMessage(TRIGGER, { triggerTurn: true });
  };

  pi.registerCommand("retry", {
    description: "Retry the last prompt (after an errored or aborted response)",
    handler: async (_args, ctx) => {
      if (ctx.isIdle() && failed) manual();
      else ctx.ui.notify("Nothing to retry.", "warning");
    },
  });

  // registerShortcut only fires while the default editor handles input, so
  // modal/selector dialogs are unaffected — no focus detection needed.
  pi.registerShortcut("alt+r", {
    description: "Retry the last prompt",
    handler: (ctx) => {
      if (ctx.isIdle() && failed) manual();
    },
  });
}
