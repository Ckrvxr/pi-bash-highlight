# pi-bash-highlight

A minimal Pi extension that adds syntax highlighting to the native `bash` command preview. Tool execution and result rendering are delegated to Pi's original tool definition.

- `bash`: uses Shiki's Bash grammar and maps token colors to the active Pi theme; only the command is highlighted, stdout/stderr are untouched.
- `edit`: uses Pi's native renderer unchanged; this extension does not add syntax highlighting to Edit diffs.
- No changes to `write`, tool schemas, execution behavior, labels, or other UI elements.

## Try it

Load it for one Pi session without changing your Pi settings:

```sh
pi -e npm:pi-bash-highlight
```

## License

Apache-2.0. See [LICENSE](./LICENSE).

## Tests

```sh
pnpm test
```
