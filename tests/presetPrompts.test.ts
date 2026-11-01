/**
 * Tests for app/src/components/presetPrompts.ts — F-015 sidepanel chips.
 */
import { describe, expect, test } from "bun:test";
import { PRESET_PROMPTS, resolvePresetPrompts, type PresetPrompt } from "../app/src/components/presetPrompts";

declare const globalThis: { AGENTTRACE_PRESET_PROMPTS?: unknown };

describe("PRESET_PROMPTS", () => {
  test("ships three default chips with stable ids and i18n label keys", () => {
    expect(PRESET_PROMPTS.length).toBe(3);
    const ids = PRESET_PROMPTS.map((p) => p.id);
    expect(ids).toEqual(["whatWentWrong", "toolsAvailable", "annotateTrace"]);
    for (const p of PRESET_PROMPTS) {
      expect(p.labelKey.startsWith("chat.preset.")).toBe(true);
      expect(p.prompt.length).toBeGreaterThan(10);
    }
  });
});

describe("resolvePresetPrompts", () => {
  test("returns bundled defaults when no global override is set", () => {
    delete globalThis.AGENTTRACE_PRESET_PROMPTS;
    expect(resolvePresetPrompts()).toBe(PRESET_PROMPTS);
  });

  test("uses the global override when it is a valid array", () => {
    const override: PresetPrompt[] = [
      { id: "explainErrors", labelKey: "chat.preset.explainErrors", prompt: "Explain every error span in this trace." },
      { id: "summarize", labelKey: "chat.preset.summarize", prompt: "Summarize this trace in 3 sentences." },
    ];
    globalThis.AGENTTRACE_PRESET_PROMPTS = override;
    expect(resolvePresetPrompts()).toEqual(override);
    delete globalThis.AGENTTRACE_PRESET_PROMPTS;
  });

  test("falls back to defaults when override items are missing required fields", () => {
    globalThis.AGENTTRACE_PRESET_PROMPTS = [
      { id: "ok", labelKey: "x", prompt: "y" },
      { id: "missing-label" }, // invalid
      { labelKey: "no-id", prompt: "z" }, // invalid
      { id: "empty-prompt", labelKey: "k", prompt: "" }, // invalid
    ];
    expect(resolvePresetPrompts()).toEqual([{ id: "ok", labelKey: "x", prompt: "y" }]);
    delete globalThis.AGENTTRACE_PRESET_PROMPTS;
  });

  test("falls back to bundled defaults when override array is empty", () => {
    globalThis.AGENTTRACE_PRESET_PROMPTS = [];
    expect(resolvePresetPrompts()).toBe(PRESET_PROMPTS);
    delete globalThis.AGENTTRACE_PRESET_PROMPTS;
  });

  test("falls back when override is not an array", () => {
    globalThis.AGENTTRACE_PRESET_PROMPTS = "not an array";
    expect(resolvePresetPrompts()).toBe(PRESET_PROMPTS);
    delete globalThis.AGENTTRACE_PRESET_PROMPTS;
  });
});
