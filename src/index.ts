import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  getLanguageFromPath,
  highlightCode,
  renderDiff,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, colorToHex, foregroundAnsi, parseColor } from "@earendil-works/pi-tui";
import bashGrammar from "shiki/langs/bash.mjs";
import { createHighlighterCoreSync } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { buildPiShikiTheme, getPiShikiThemeName, renderShikiTokens, type PiShikiPalette } from "./shiki-rendering.ts";
import { MAX_BASH_COMMAND_CHARS, prepareEditDiffForHighlighting, highlightBashCommand, highlightEditDiff, restoreBaseForeground, styleEditDiffLine } from "./rendering.ts";

function hashText(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${text.length}:${first >>> 0}:${second >>> 0}`;
}

function editThemeKey(theme: Theme): string {
  const tokens = [
    "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword",
    "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType",
    "syntaxOperator", "syntaxPunctuation",
  ] as const;
  return `${theme.name ?? ""}:${theme.appearance}:${theme.getColorMode()}:${tokens.map((token) => theme.getFgAnsi(token)).join("")}`;
}

function getPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const values = args as { path?: unknown; file_path?: unknown };
  if (typeof values.file_path === "string") return values.file_path;
  return typeof values.path === "string" ? values.path : undefined;
}

function getPiShikiPalette(theme: Theme): PiShikiPalette {
  return {
    appearance: theme.appearance,
    foreground: colorToHex(theme.colors.toolTitle),
    colors: {
      syntaxComment: colorToHex(theme.colors.syntaxComment),
      syntaxKeyword: colorToHex(theme.colors.syntaxKeyword),
      syntaxFunction: colorToHex(theme.colors.syntaxFunction),
      syntaxVariable: colorToHex(theme.colors.syntaxVariable),
      syntaxString: colorToHex(theme.colors.syntaxString),
      syntaxNumber: colorToHex(theme.colors.syntaxNumber),
      syntaxType: colorToHex(theme.colors.syntaxType),
      syntaxOperator: colorToHex(theme.colors.syntaxOperator),
      syntaxPunctuation: colorToHex(theme.colors.syntaxPunctuation),
    },
  };
}

type ShikiEngine = Awaited<ReturnType<typeof createOnigurumaEngine>>;

const loadedBashThemes = new Set<string>();
let bashHighlighter: ReturnType<typeof createHighlighterCoreSync> | undefined;

function getBashHighlighter(theme: Theme, engine: ShikiEngine) {
  const palette = getPiShikiPalette(theme);
  const name = getPiShikiThemeName(palette);

  if (!bashHighlighter) {
    bashHighlighter = createHighlighterCoreSync({
      langs: [bashGrammar],
      themes: [buildPiShikiTheme(palette, name)],
      engine,
      warnings: false,
    });
    loadedBashThemes.add(name);
  } else if (!loadedBashThemes.has(name)) {
    bashHighlighter.loadThemeSync(buildPiShikiTheme(palette, name));
    loadedBashThemes.add(name);
  }

  return { highlighter: bashHighlighter, themeName: name };
}

function highlightBashWithShiki(command: string, theme: Theme, engine: ShikiEngine): string {
  const baseForeground = theme.getFgAnsi("toolTitle");
  if (command.length > MAX_BASH_COMMAND_CHARS) return command;
  try {
    const { highlighter, themeName } = getBashHighlighter(theme, engine);
    const { tokens } = highlighter.codeToTokens(command, { lang: "bash", theme: themeName });
    return renderShikiTokens(
      tokens,
      (color) => foregroundAnsi(parseColor(color), theme.getColorMode()),
      baseForeground,
    );
  } catch {
    return restoreBaseForeground(highlightBashCommand(command, highlightCode), baseForeground);
  }
}

function getStateKey(state: unknown): object | undefined {
  return state !== null && (typeof state === "object" || typeof state === "function")
    ? state as object
    : undefined;
}

export default async function (pi: ExtensionAPI) {
  const shikiEngine = await createOnigurumaEngine(import("shiki/wasm"));
  const cwd = process.cwd();

  const bash = createBashToolDefinition(cwd);
  const nativeBashRenderCall = bash.renderCall;

  pi.registerTool({
    ...bash,
    renderCall(args, theme, context) {
      if (!args || typeof args.command !== "string" || !args.command) {
        return nativeBashRenderCall?.(args, theme, context) ?? new Text("", 0, 0);
      }

      const command = highlightBashWithShiki(args.command, theme, shikiEngine);
      const timeout = args.timeout
        ? theme.fg("muted", ` (timeout ${args.timeout}s)`)
        : "";
      const content = `${theme.fg("toolTitle", theme.bold(`bash ${command}`))}${timeout}`;
      const component = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      component.setText(content);
      return component;
    },
  });

  const edit = createEditToolDefinition(cwd);
  const nativeEditRenderCall = edit.renderCall;
  const nativeEditRenderResult = edit.renderResult;
  const editCallComponents = new WeakMap<object, Box>();
  const editHighlights = new WeakMap<Box, { key: string; highlighted: string }>();

  function highlightEditComponent(component: Box, args: unknown, theme: Parameters<NonNullable<typeof nativeEditRenderCall>>[1]) {
    const path = getPath(args);
    const language = path ? getLanguageFromPath(path) : undefined;
    if (!language) return;

    const textChildren = component.children.filter((child): child is Text => child instanceof Text);
    const preview = textChildren[1];
    if (!preview) return;

    // Reuse Pi's renderer output without Text.render(), which pads every line to its render width.
    const diff = prepareEditDiffForHighlighting(
      (component as Box & { preview?: unknown }).preview,
      renderDiff,
    );
    if (diff === undefined) return;

    const key = `${language}:${editThemeKey(theme)}:${hashText(diff)}`;
    const cached = editHighlights.get(component);
    if (cached?.key === key) {
      preview.setText(cached.highlighted);
      component.invalidate();
      return;
    }

    const highlighted = highlightEditDiff(
      diff,
      language,
      highlightCode,
      (kind, prefix, code) => styleEditDiffLine(theme, kind, prefix, code),
    );
    if (highlighted === undefined) return;

    editHighlights.set(component, { key, highlighted });
    preview.setText(highlighted);
    component.invalidate();
  }

  pi.registerTool({
    ...edit,
    renderCall(args, theme, context) {
      const component = nativeEditRenderCall?.(args, theme, context);
      if (!(component instanceof Box)) return component ?? new Container();

      const stateKey = getStateKey(context.state);
      if (stateKey) editCallComponents.set(stateKey, component);
      highlightEditComponent(component, args, theme);
      return component;
    },
    renderResult(result, options, theme, context) {
      const resultComponent = nativeEditRenderResult?.(result, options, theme, context) ?? new Container();
      const stateKey = getStateKey(context.state);
      const callComponent = stateKey ? editCallComponents.get(stateKey) : undefined;
      if (callComponent) highlightEditComponent(callComponent, context.args, theme);
      return resultComponent;
    },
  });
}
