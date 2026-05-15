# GXZ Code VS Code Extension

This extension connects VS Code to a local GXZ-code bridge.

Start the bridge from the GXZ-code package root:

```bash
node dist/src/cli.js bridge --port 37818
```

Then open this folder in VS Code and run "Developer: Install Extension from Location..." or package it with `vsce`.

Commands:

- `GXZ Code: Ask`
- `GXZ Code: Explain Selection`
- `GXZ Code: Review Current File`
- `GXZ Code: Run Diagnostics`
- `GXZ Code: Run Code Action`

The extension never stores provider API keys. The bridge process reads provider credentials from its own environment.
