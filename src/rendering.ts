export type HighlightCode = (code: string, language: string) => string[];
export type DiffLineKind = "added" | "removed" | "context";
export type StyleDiffLine = (kind: DiffLineKind, prefix: string, code: string) => string;
export type DiffTheme = {
  fg: (color: "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext", text: string) => string;
  getFgAnsi: (color: "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext") => string;
};

type DiffRow = {
  kind: DiffLineKind | "raw" | "marker";
  prefix: string;
  code: string;
  inverseMask?: boolean[];
  oldIndex?: number;
  newIndex?: number;
};

type AnsiLine = { text: string; inverseMask: boolean[] };

const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[@-_])|\u009B[0-?]*[ -/]*[@-~]/g;
const ANSI_SEQUENCE_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[@-_])|\u009B[0-?]*[ -/]*[@-~]/y;
const DIFF_LINE_PATTERN = /^([+\- ])(\s*\d*)\s(.*)$/;
export const MAX_BASH_COMMAND_CHARS = 64_000;
export const MAX_EDIT_DIFF_CHARS = 256_000;

export function highlightBashCommand(command: string, highlightCode: HighlightCode): string {
  if (command.length > MAX_BASH_COMMAND_CHARS) return command;
  const highlighted = highlightCode(command, "bash");
  return highlighted.length > 0 ? highlighted.join("\n") : command;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function prepareEditDiffForHighlighting(
  preview: unknown,
  renderNativeDiff: (diff: string) => string,
): string | undefined {
  if (!preview || typeof preview !== "object" || !("diff" in preview)) return undefined;
  const sourceDiff = preview.diff;
  if (typeof sourceDiff !== "string" || sourceDiff.length > MAX_EDIT_DIFF_CHARS) return undefined;

  const renderedDiff = renderNativeDiff(sourceDiff);
  return renderedDiff.length <= MAX_EDIT_DIFF_CHARS ? renderedDiff : undefined;
}

export function restoreBaseForeground(code: string, baseForeground: string): string {
  return code.replace(/(?:\u001B\[39m|\u009B39m)/g, (reset) => `${reset}${baseForeground}`);
}

export function styleEditDiffLine(
  theme: DiffTheme,
  kind: DiffLineKind,
  prefix: string,
  code: string,
): string {
  const token = kind === "added"
    ? "toolDiffAdded"
    : kind === "removed" ? "toolDiffRemoved" : "toolDiffContext";
  const baseForeground = theme.getFgAnsi(token);
  return theme.fg(token, `${prefix}${restoreBaseForeground(code, baseForeground)}`);
}

function isInverseSgr(sequence: string): { value: boolean } | undefined {
  if (!sequence.endsWith("m") || !(sequence.startsWith("\u001B[") || sequence.startsWith("\u009B"))) {
    return undefined;
  }

  const parameterText = sequence.slice(sequence.startsWith("\u009B") ? 1 : 2, -1);
  let inverse: boolean | undefined;
  for (const rawParameter of parameterText.split(";")) {
    const parameter = rawParameter === "" ? 0 : Number(rawParameter);
    if (parameter === 0 || parameter === 27) inverse = false;
    if (parameter === 7) inverse = true;
  }
  return inverse === undefined ? undefined : { value: inverse };
}

function splitAnsiLines(text: string): AnsiLine[] {
  const lines: AnsiLine[] = [{ text: "", inverseMask: [] }];
  let inverse = false;

  for (let index = 0; index < text.length;) {
    if (text[index] === "\u001B" || text[index] === "\u009B") {
      ANSI_SEQUENCE_PATTERN.lastIndex = index;
      const sequence = ANSI_SEQUENCE_PATTERN.exec(text)?.[0];
      if (sequence) {
        const inverseSgr = isInverseSgr(sequence);
        if (inverseSgr) inverse = inverseSgr.value;
        index += sequence.length;
        continue;
      }
    }

    if (text[index] === "\n") {
      lines.push({ text: "", inverseMask: [] });
      inverse = false;
      index++;
      continue;
    }

    const codePoint = String.fromCodePoint(text.codePointAt(index)!);
    const line = lines[lines.length - 1];
    line.text += codePoint;
    line.inverseMask.push(inverse);
    index += codePoint.length;
  }

  return lines;
}

function normalizeCodeAndMask(code: string, mask: boolean[]): { code: string; mask: boolean[] } {
  let normalized = "";
  const normalizedMask: boolean[] = [];
  const codePoints = Array.from(code);

  for (let index = 0; index < codePoints.length; index++) {
    const point = codePoints[index];
    const inverse = mask[index] ?? false;
    if (point === "\t") {
      normalized += "   ";
      normalizedMask.push(inverse, inverse, inverse);
    } else {
      normalized += point;
      normalizedMask.push(inverse);
    }
  }

  return { code: normalized, mask: normalizedMask };
}

function applyInverseMask(highlighted: string, source: string, mask: boolean[]): string {
  if (!mask.some(Boolean) || stripAnsi(highlighted) !== source) return highlighted;

  let output = "";
  let index = 0;
  let inverse = false;
  for (let offset = 0; offset < highlighted.length;) {
    if (highlighted[offset] === "\u001B" || highlighted[offset] === "\u009B") {
      ANSI_SEQUENCE_PATTERN.lastIndex = offset;
      const sequence = ANSI_SEQUENCE_PATTERN.exec(highlighted)?.[0];
      if (sequence) {
        output += sequence;
        const inverseSgr = isInverseSgr(sequence);
        if (inverseSgr) inverse = inverseSgr.value;
        offset += sequence.length;
        continue;
      }
    }

    const codePoint = String.fromCodePoint(highlighted.codePointAt(offset)!);
    const desiredInverse = mask[index] ?? false;
    if (desiredInverse !== inverse) {
      output += desiredInverse ? "\u001B[7m" : "\u001B[27m";
      inverse = desiredInverse;
    }
    output += codePoint;
    index++;
    offset += codePoint.length;
  }

  if (inverse) output += "\u001B[27m";
  return output;
}

/** Highlight edit diff code while retaining Pi's diff and word-change colors. */
export function highlightEditDiff(
  diff: string,
  language: string,
  highlightCode: HighlightCode,
  styleLine: StyleDiffLine,
): string | undefined {
  if (diff.length > MAX_EDIT_DIFF_CHARS) return undefined;

  const rows: DiffRow[] = [];
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let hasCodeRow = false;

  for (const styledLine of splitAnsiLines(diff)) {
    const match = styledLine.text.match(DIFF_LINE_PATTERN);
    if (!match) {
      rows.push({ kind: "raw", prefix: styledLine.text, code: "" });
      continue;
    }

    const [, marker, lineNumber, rawCode] = match;
    const prefix = styledLine.text.slice(0, styledLine.text.length - rawCode.length);
    if (!lineNumber.trim() && rawCode.trim() === "...") {
      rows.push({ kind: "marker", prefix: styledLine.text, code: "" });
      continue;
    }

    hasCodeRow = true;
    const source = normalizeCodeAndMask(rawCode, styledLine.inverseMask.slice(prefix.length));
    if (marker === "-") {
      const oldIndex = oldLines.push(source.code) - 1;
      rows.push({ kind: "removed", prefix, code: source.code, inverseMask: source.mask, oldIndex });
    } else if (marker === "+") {
      const newIndex = newLines.push(source.code) - 1;
      rows.push({ kind: "added", prefix, code: source.code, inverseMask: source.mask, newIndex });
    } else {
      const oldIndex = oldLines.push(source.code) - 1;
      const newIndex = newLines.push(source.code) - 1;
      rows.push({ kind: "context", prefix, code: source.code, inverseMask: source.mask, oldIndex, newIndex });
    }
  }

  if (!hasCodeRow) return undefined;

  const oldHighlighted = oldLines.length > 0 ? highlightCode(oldLines.join("\n"), language) : [];
  const newHighlighted = newLines.length > 0 ? highlightCode(newLines.join("\n"), language) : [];

  return rows.map((row) => {
    if (row.kind === "raw" || row.kind === "marker") {
      return styleLine("context", row.prefix, "");
    }

    const highlighted = row.kind === "removed"
      ? oldHighlighted[row.oldIndex ?? -1]
      : newHighlighted[row.newIndex ?? -1];
    const code = applyInverseMask(highlighted ?? row.code, row.code, row.inverseMask ?? []);
    return styleLine(row.kind, row.prefix, code);
  }).join("\n");
}
