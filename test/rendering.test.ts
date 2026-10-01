import assert from "node:assert/strict";
import test from "node:test";
import { extractTextContent, highlightBashCommand, highlightEditDiff, restoreBaseForeground, stripAnsi, styleEditDiffLine } from "../src/rendering.ts";

const highlighter = (code: string, language: string) =>
  code.split("\n").map((line) => `<${language}:${line}>`);
const styleDiffLine = (kind: string, prefix: string, code: string) => `[${kind}]${prefix}${code}[/]`;

test("highlights the bash command as a complete multiline shell snippet", () => {
  assert.equal(
    highlightBashCommand("printf '%s\\n' hello\nprintf done", highlighter),
    "<bash:printf '%s\\n' hello>\n<bash:printf done>",
  );
});

test("releases Text render caches after extracting preview content", () => {
  let cached = false;
  const component = {
    render: () => {
      cached = true;
      return ["one", "two"];
    },
    invalidate: () => {
      cached = false;
    },
  };

  assert.equal(extractTextContent(component, 1_000_000, 100), "one\ntwo");
  assert.equal(cached, false);
});

test("does not retain an oversized Text render cache", () => {
  let cached = false;
  const component = {
    render: () => {
      cached = true;
      return ["x".repeat(20)];
    },
    invalidate: () => {
      cached = false;
    },
  };

  assert.equal(extractTextContent(component, 1_000_000, 10), undefined);
  assert.equal(cached, false);
});

test("leaves oversized Bash commands unhighlighted", () => {
  let highlightCalls = 0;
  const command = "x".repeat(64_001);

  assert.equal(highlightBashCommand(command, () => {
    highlightCalls++;
    return [];
  }), command);
  assert.equal(highlightCalls, 0);
});

test("restores Pi's original foreground between syntax-highlighted bash tokens", () => {
  assert.equal(
    restoreBaseForeground("\u001b[38;2;1;2;3mif\u001b[39m [ -f file ]", "<toolTitle>"),
    "\u001b[38;2;1;2;3mif\u001b[39m<toolTitle> [ -f file ]",
  );
});

test("highlights added, removed, and context code using the file language", () => {
  const diff = [
    "-1 const answer = 1;",
    "+1 const answer = 2;",
    " 2 console.log(answer);",
  ].join("\n");

  assert.equal(
    highlightEditDiff(diff, "typescript", highlighter, styleDiffLine),
    [
      "[removed]-1 <typescript:const answer = 1;>[/]",
      "[added]+1 <typescript:const answer = 2;>[/]",
      "[context] 2 <typescript:console.log(answer);>[/]",
    ].join("\n"),
  );
});

test("highlights each side of a changed block as its own source file", () => {
  const seen: Array<{ code: string; language: string }> = [];
  const recordingHighlighter = (code: string, language: string) => {
    seen.push({ code, language });
    return code.split("\n").map((line) => `<${line}>`);
  };

  highlightEditDiff(
    ["-1 const oldValue = 1;", "+1 const newValue = 2;", " 2 return true;"].join("\n"),
    "typescript",
    recordingHighlighter,
    styleDiffLine,
  );

  assert.deepEqual(seen, [
    { code: "const oldValue = 1;\nreturn true;", language: "typescript" },
    { code: "const newValue = 2;\nreturn true;", language: "typescript" },
  ]);
});

test("preserves Pi's inverse styling for changed words in diff lines", () => {
  const diff = "\u001b[38;2;210;80;80m-1 const value = \u001b[7m1\u001b[27m;\u001b[39m";
  const syntaxHighlighter = (code: string) => [`\u001b[38;2;100;180;220m${code}\u001b[39m`];
  const result = highlightEditDiff(diff, "typescript", syntaxHighlighter, styleDiffLine);

  assert.ok(result?.includes("\u001b[7m1\u001b[27m"));
});

test("keeps Pi's diff color active between syntax-highlighted tokens", () => {
  const fakeTheme = {
    fg: (color: string, text: string) => `[${color}]${text}[reset]`,
    getFgAnsi: (color: string) => `<${color}>`,
  };

  assert.equal(
    styleEditDiffLine(fakeTheme, "added", "+1 ", "\u001b[38;2;1;2;3mconst\u001b[39m answer"),
    "[toolDiffAdded]+1 \u001b[38;2;1;2;3mconst\u001b[39m<toolDiffAdded> answer[reset]",
  );
});

test("leaves oversized edit diffs to Pi instead of re-highlighting them", () => {
  let highlightCalls = 0;
  const diff = `+1 ${"x".repeat(256_001)}`;

  assert.equal(
    highlightEditDiff(diff, "typescript", () => {
      highlightCalls++;
      return [];
    }, styleDiffLine),
    undefined,
  );
  assert.equal(highlightCalls, 0);
});

test("strips ANSI styles before re-highlighting the native edit diff", () => {
  assert.equal(stripAnsi("\u001b[32m+1 added\u001b[0m\n\u001b[31m-1 removed\u001b[0m"), "+1 added\n-1 removed");
});
