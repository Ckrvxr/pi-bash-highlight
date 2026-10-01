import type { ThemeRegistration, ThemedToken } from "shiki";

export type PiThemeAppearance = "dark" | "light";
export type PiSyntaxColor =
  | "syntaxComment"
  | "syntaxKeyword"
  | "syntaxFunction"
  | "syntaxVariable"
  | "syntaxString"
  | "syntaxNumber"
  | "syntaxType"
  | "syntaxOperator"
  | "syntaxPunctuation";

export type PiShikiPalette = {
  appearance: PiThemeAppearance;
  foreground: string;
  colors: Record<PiSyntaxColor, string>;
};

export type PiShikiTheme = ThemeRegistration & {
  name: string;
  type: PiThemeAppearance;
  fg: string;
  settings: NonNullable<ThemeRegistration["settings"]>;
};

export type ShikiToken = Pick<ThemedToken, "content" | "color">;
export type ColorToAnsi = (color: string) => string;

const TOKEN_SCOPES: Array<{ color: PiSyntaxColor; scopes: string[] }> = [
  { color: "syntaxComment", scopes: ["comment"] },
  { color: "syntaxKeyword", scopes: ["keyword"] },
  { color: "syntaxFunction", scopes: ["entity.name.function", "support.function"] },
  { color: "syntaxVariable", scopes: ["variable"] },
  { color: "syntaxString", scopes: ["string"] },
  { color: "syntaxNumber", scopes: ["constant.numeric"] },
  { color: "syntaxType", scopes: ["storage.type", "entity.name.type"] },
  { color: "syntaxOperator", scopes: ["keyword.operator", "punctuation.operator"] },
  { color: "syntaxPunctuation", scopes: ["punctuation"] },
];

export function getPiShikiThemeName(palette: PiShikiPalette): string {
  const colors = [palette.foreground, ...Object.values(palette.colors)]
    .map((color) => color.replace(/^#/, "").toUpperCase());
  return `pi-${palette.appearance}-${colors.join("-")}`;
}

export function buildPiShikiTheme(
  palette: PiShikiPalette,
  name = "pi-active-theme",
): PiShikiTheme {
  return {
    name,
    type: palette.appearance,
    fg: palette.foreground,
    settings: TOKEN_SCOPES.map(({ color, scopes }) => ({
      scope: scopes,
      settings: { foreground: palette.colors[color] },
    })),
  };
}

export function renderShikiTokens(
  lines: readonly (readonly ShikiToken[])[],
  colorToAnsi: ColorToAnsi,
  baseForeground: string,
): string {
  return lines.map((line) => line.map((token) => {
    if (!token.color) return token.content;
    return `${colorToAnsi(token.color)}${token.content}\u001b[39m${baseForeground}`;
  }).join("")).join("\n");
}
