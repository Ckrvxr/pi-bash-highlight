# pi-extra-highlights

A minimal Pi extension that adds syntax highlighting to the native `bash` command preview and `edit` diff preview. Tool execution and result rendering are delegated to Pi's original tool definitions.

- `bash`: uses Shiki's Bash grammar and maps token colors to the active Pi theme; only the command is highlighted, stdout/stderr are untouched.
- `edit`: uses Pi's `write` renderer language detection (`getLanguageFromPath` / `highlightCode`) for context lines. Added/removed lines stay solid green/red and retain Pi's inline changed-word styling. Unknown file types and oversized previews keep native rendering.
- No changes to `write`, tool schemas, execution behavior, labels, or other UI elements.

## Try it

Load it for one Pi session without changing your Pi settings:

```sh
pi -e npm:pi-extra-highlights
```

## License

Apache-2.0. See [LICENSE](./LICENSE).

## Tests

```sh
pnpm test
```
