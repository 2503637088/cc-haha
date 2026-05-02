# Contributing

Thanks for helping improve Claude Code Haha.

For the full contributor guide, including local checks, live model baselines, quality-gate reports, and PR expectations, see:

- Chinese: [docs/guide/contributing.md](docs/guide/contributing.md)
- English: [docs/en/guide/contributing.md](docs/en/guide/contributing.md)

Most contributors should run this before opening a PR:

```bash
bun install
bun run quality:pr
```

If you run adapter or native checks on a fresh clone, install adapter dependencies too:

```bash
cd adapters
bun install
```

If your change touches the desktop chat path, provider/runtime selection, CLI bridge, permissions, tools, file editing, or release packaging, also run a live baseline with your own local model provider:

```bash
bun run quality:providers
bun run quality:gate --mode baseline --allow-live --provider-model <selector>:main
```

Quality reports are written under `artifacts/quality-runs/<timestamp>/`.
