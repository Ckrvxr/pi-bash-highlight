export type HighlightCode = (code: string, language: string) => string[];

export const MAX_BASH_COMMAND_CHARS = 64_000;

export function highlightBashCommand(command: string, highlightCode: HighlightCode): string {
  if (command.length > MAX_BASH_COMMAND_CHARS) return command;
  const highlighted = highlightCode(command, "bash");
  return highlighted.length > 0 ? highlighted.join("\n") : command;
}

export function restoreBaseForeground(code: string, baseForeground: string): string {
  return code.replace(/(?:\u001B\[39m|\u009B39m)/g, (reset) => `${reset}${baseForeground}`);
}
