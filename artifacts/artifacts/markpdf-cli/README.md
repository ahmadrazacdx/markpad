# MarkPDF CLI

Minimal terminal-first Markdown to PDF converter:

- `markpdf --version` prints the version.
- `markpdf --help` prints usage.
- `markpdf uninstall` launches the installer uninstaller on Windows.
- `markpdf` opens a localhost UI in the browser.

## Features

- Accepts markdown files (`.md`/`.markdown`) plus full project bundles.
- Project bundles can be uploaded as a folder (markdown + assets) or a `.zip` archive.
- Validates and auto-fixes common Markdown layout issues using `markdownlint` style rules.
- Converts with `pandoc`.
- Batch mode up to 50 files using async conversion.
- Returns a single PDF for one file, or a ZIP for batch output.

## Local Dev

```bash
pnpm --filter @workspace/markpdf-cli install
pnpm --filter @workspace/markpdf-cli run dev
```

## Build

```bash
pnpm --filter @workspace/markpdf-cli run build
```

## Windows EXE

```bash
pnpm --filter @workspace/markpdf-cli run dist:win
```

This creates `out/markpdf.exe`.
