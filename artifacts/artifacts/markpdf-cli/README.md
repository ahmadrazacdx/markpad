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

_This creates `out/markpdf-cli.exe` (internal CLI payload used by the installer pipeline).

The Windows CI workflow packages this payload together with `pandoc.exe` into a single installer executable:

- `out/markpdf.exe`

After installing, open a new terminal session and run:

- `markpdf --version`
- `markpdf --help`
- `markpdf`
- `markpdf uninstall`
