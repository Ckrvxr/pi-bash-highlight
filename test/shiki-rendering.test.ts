import assert from "node:assert/strict";
import test from "node:test";
import bash from "shiki/langs/bash.mjs";
import { createHighlighterCoreSync } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { buildPiShikiTheme, getPiShikiThemeName, renderShikiTokens } from "../src/shiki-rendering.ts";

const onigurumaEngine = await createOnigurumaEngine(import("shiki/wasm"));
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

const palette = {
  appearance: "dark" as const,
  foreground: "#d0d0d0",
  colors: {
    syntaxComment: "#808080",
    syntaxKeyword: "#ff0000",
    syntaxFunction: "#ffaa00",
    syntaxVariable: "#00aaff",
    syntaxString: "#00ff00",
    syntaxNumber: "#ff00ff",
    syntaxType: "#ffff00",
    syntaxOperator: "#00ffff",
    syntaxPunctuation: "#ffffff",
  },
};

test("builds a Shiki theme from the active Pi syntax palette", () => {
  const theme = buildPiShikiTheme(palette);

  assert.equal(theme.name, "pi-active-theme");
  assert.equal(getPiShikiThemeName(palette), "pi-dark-D0D0D0-808080-FF0000-FFAA00-00AAFF-00FF00-FF00FF-FFFF00-00FFFF-FFFFFF");
  assert.equal(theme.type, "dark");
  assert.equal(theme.fg, palette.foreground);
  assert.ok(theme.settings.some((setting) =>
    setting.scope?.includes("keyword") && setting.settings?.foreground === palette.colors.syntaxKeyword,
  ));
  assert.ok(theme.settings.some((setting) =>
    setting.scope?.includes("string") && setting.settings?.foreground === palette.colors.syntaxString,
  ));
});

test("tokenizes Bash with Shiki using Pi's syntax palette", () => {
  const highlighter = createHighlighterCoreSync({
    langs: [bash],
    themes: [buildPiShikiTheme(palette)],
    engine: onigurumaEngine,
    warnings: false,
  });
  const command = 'if [ -f "$path" ]; then\n  echo "found";\nfi';
  const tokenLines = highlighter.codeToTokens(command, {
    lang: "bash",
    theme: "pi-active-theme",
  }).tokens;
  const tokens = tokenLines.flat();

  assert.equal(
    stripAnsi(renderShikiTokens(
      tokenLines,
      (color) => {
        const [red, green, blue] = color.slice(1).match(/.{2}/g)!.map((channel) => Number.parseInt(channel, 16));
        return `\u001b[38;2;${red};${green};${blue}m`;
      },
      "",
    )),
    command,
  );
  assert.ok(tokens.some((token) => token.content === "if" && token.color === palette.colors.syntaxKeyword.toUpperCase()));
  assert.ok(tokens.some((token) => token.content === "echo" && token.color === palette.colors.syntaxFunction.toUpperCase()));
  assert.ok(tokens.some((token) => token.content === "found" && token.color === palette.colors.syntaxString.toUpperCase()));
});

test("loads a separate Shiki theme when Pi's palette changes", () => {
  const highlighter = createHighlighterCoreSync({
    langs: [bash],
    themes: [buildPiShikiTheme(palette, getPiShikiThemeName(palette))],
    engine: onigurumaEngine,
    warnings: false,
  });
  const lightPalette = {
    ...palette,
    appearance: "light" as const,
    colors: { ...palette.colors, syntaxKeyword: "#0000ff" },
  };
  highlighter.loadThemeSync(buildPiShikiTheme(lightPalette, getPiShikiThemeName(lightPalette)));

  const tokens = highlighter.codeToTokens("if", {
    lang: "bash",
    theme: getPiShikiThemeName(lightPalette),
  }).tokens.flat();
  assert.equal(tokens.find((token) => token.content === "if")?.color, "#0000FF");
});

test("renders Shiki tokens to ANSI using Pi's foreground style between tokens", () => {
  const result = renderShikiTokens(
    [
      [
        { content: "if", color: "#ff0000" },
        { content: " ", color: "#d0d0d0" },
        { content: "echo", color: "#ffaa00" },
      ],
      [{ content: "done" }],
    ],
    (color) => `<${color}>`,
    "<pi-foreground>",
  );

  assert.equal(
    result,
    "<#ff0000>if\u001b[39m<pi-foreground><#d0d0d0> \u001b[39m<pi-foreground><#ffaa00>echo\u001b[39m<pi-foreground>\ndone",
  );
});
