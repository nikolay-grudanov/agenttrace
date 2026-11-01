/**
 * F-015: Configurable sidepanel prompt chips (TraceDebugPrompt).
 *
 * The TraceDebugPrompt row in MessagePane shows a horizontal strip of clickable
 * chips when the chat is empty and a run is focused. Adding a chip previously
 * required editing the JSX inline; this module turns the chips into a data
 * table so new entries are one-line additions and can be extended at runtime
 * (deployers can override via `window.AGENTTRACE_PRESET_PROMPTS`).
 *
 * Labels are i18n keys, not strings — see `app/src/i18n/locales/en.json`
 * (`chat.preset.*`). The `prompt` field is sent verbatim to the agent and is
 * intentionally NOT translated (it is the actual question we want the agent
 * to reason about, regardless of the operator's UI language). Operators who
 * want localized prompts should override the array via the runtime hook.
 */

export interface PresetPrompt {
  /** Stable id for React keys + runtime overrides. Lowercase, no spaces. */
  id: string;
  /** i18n key used for the chip's label (see en.json / ru.json). */
  labelKey: string;
  /** Verbatim prompt string sent to the agent when the chip is clicked. */
  prompt: string;
}

export const PRESET_PROMPTS: PresetPrompt[] = [
  {
    id: "whatWentWrong",
    labelKey: "chat.preset.whatWentWrong",
    prompt:
      "What went wrong here? Inspect the focused run and the failing spans, and tell me what to fix.",
  },
  {
    id: "toolsAvailable",
    labelKey: "chat.preset.toolsAvailable",
    prompt:
      "What workshop tools are available to you? List each `workshop__*` tool with a one-line description.",
  },
  {
    id: "annotateTrace",
    labelKey: "chat.preset.annotateTrace",
    prompt: "Annotate this trace with a short summary so I can find it later in the saved events list.",
  },
];

/**
 * Resolve the effective list of preset prompts. Reads `window.AGENTTRACE_PRESET_PROMPTS`
 * once (a JSON array of `PresetPrompt`-shaped objects) — if present, validated
 * minimally and used. Otherwise returns the bundled `PRESET_PROMPTS`. Safe to
 * call from render (read-only access to `globalThis`).
 */
export function resolvePresetPrompts(): PresetPrompt[] {
  const override = (globalThis as unknown as { AGENTTRACE_PRESET_PROMPTS?: unknown }).AGENTTRACE_PRESET_PROMPTS;
  if (!Array.isArray(override)) return PRESET_PROMPTS;
  const cleaned: PresetPrompt[] = [];
  for (const item of override) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id === "string" &&
      typeof candidate.labelKey === "string" &&
      typeof candidate.prompt === "string" &&
      candidate.id.length > 0 &&
      candidate.prompt.length > 0
    ) {
      cleaned.push({
        id: candidate.id,
        labelKey: candidate.labelKey,
        prompt: candidate.prompt,
      });
    }
  }
  return cleaned.length > 0 ? cleaned : PRESET_PROMPTS;
}
