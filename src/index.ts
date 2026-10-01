import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, highlightCode } from "@earendil-works/pi-coding-agent";
import { Text, colorToHex, foregroundAnsi, parseColor } from "@earendil-works/pi-tui";
import bashGrammar from "shiki/langs/bash.mjs";
import { createHighlighterCoreSync } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { buildPiShikiTheme, getPiShikiThemeName, renderShikiTokens, type PiShikiPalette } from "./shiki-rendering.ts";
import { MAX_BASH_COMMAND_CHARS, highlightBashCommand, restoreBaseForeground } from "./rendering.ts";

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

}
