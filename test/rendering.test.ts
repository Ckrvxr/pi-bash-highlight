import assert from "node:assert/strict";
import test from "node:test";
import { highlightBashCommand, restoreBaseForeground } from "../src/rendering.ts";

const highlighter = (code: string, language: string) =>
  code.split("\n").map((line) => `<${language}:${line}>`);

test("highlights the bash command as a complete multiline shell snippet", () => {
  assert.equal(
    highlightBashCommand("printf '%s\\n' hello\nprintf done", highlighter),
    "<bash:printf '%s\\n' hello>\n<bash:printf done>",
  );
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
