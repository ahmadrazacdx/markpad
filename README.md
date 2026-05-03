<div align="center">
	<img src="artifacts/artifacts/marktex/public/banner.svg" alt="MarkTex logo"/>
</div>

# MarkTex

[![Release](https://img.shields.io/github/v/release/ahmadrazacdx/marktex?display_name=tag)](https://github.com/ahmadrazacdx/marktex/releases)
[![License](https://img.shields.io/github/license/ahmadrazacdx/marktex)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4)](https://github.com/ahmadrazacdx/marktex/releases)

*Overleaf For People Who Think In Markdown.*

I built this because writing LaTeX directly in Overleaf felt tedious for my day-to-day workflow.
I moved to Markdown + Pandoc in VS Code, but that became command-heavy very quickly, and previewing output meant constantly switching context.
I wanted one small, offline tool where I can write Markdown and see a live PDF preview in real time.

**MarkTex** is that tool.

## What This Repository Contains

1. **MarkTex**: a local-first desktop writing app (editor + project manager + live PDF preview + version control).
2. **MarkPDF**: a Markdown-to-PDF tool that opens as localhost browser tab.

The idea is simple: MarkTex for full writing workflow, MarkPDF for quick conversion jobs.
Detailed MarkPDF notes are in [artifacts/artifacts/markpdf-cli/README.md](artifacts/artifacts/markpdf-cli/README.md).

## What It Looks Like

### MarkTex
<div align="center">
	<img src="artifacts/artifacts/marktex/public/marktex_preview.png" alt="MarkTex UI screenshot" />
</div>

### MarkPDF
<div align="center">
	<img src="artifacts/artifacts/marktex/public/markpdf_preview.png" alt="MarkPDF UI screenshot" />
</div>

## Core Behavior

- Write Markdown in a CodeMirror-based editor.
- Get live PDF preview through a local render pipeline.
- Organize writing into projects/files.
- Keep version history and restore past states.
- Export to PDF from a local/offline setup.

## Install (Windows)

1. Open [Releases](https://github.com/ahmadrazacdx/marktex/releases).
2. Download the latest MarkTex installer.
3. Run the installer and launch MarkTex.
4. Optional: install MarkPDF from the same release artifacts.

## Quick Start

### MarkTex (desktop app)

```bash
pnpm install
pnpm --filter @workspace/marktex run tauri:dev
```

### MarkPDF (CLI + localhost UI)

```bash
pnpm install
pnpm --filter @workspace/markpdf-cli run dev
```

If MarkPDF is installed globally on Windows, you can use:

```bash
markpdf --version
markpdf --help
markpdf
markpdf uninstall
```

### MarkPDF at a glance

- Accepts `.md` / `.markdown` files and project bundles.
- Supports folder upload or `.zip` upload workflows.
- Applies markdownlint-style auto-fixes for common formatting issues.
- Converts through Pandoc.
- Supports batch mode (up to 50 files).
- Returns a single PDF for one file, or a ZIP for batch output.

> **Warning**: MarkPDF is an experimental tool and is not guaranteed to work.

## Development

For web development of the editor + backend, run these in separate terminals:

```bash
cd artifacts/artifacts/api-server
PORT=8080 pnpm run dev
```

```bash
cd artifacts/artifacts/marktex
pnpm run dev
```

Note: in browser-based dev, keep API requests relative (`/api`) and use the Vite proxy.

## Build and Test

Workspace-level checks:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

Windows desktop build:

```bash
pnpm --filter @workspace/marktex run tauri:build:windows
```

MarkPDF Windows CLI payload:

```bash
pnpm --filter @workspace/markpdf-cli run dist:win
```

## Stack

- Desktop shell: Tauri 2
- Frontend: React + Vite + CodeMirror
- Backend: Express + WebSocket
- Rendering: Pandoc + Typst
- Data: SQLite (libSQL) + Drizzle ORM

## Use Cases

- Writing papers, reports, or notes in Markdown while seeing PDF layout live.
- Running a local-first writing workflow that works fully offline.
- Managing multi-file writing projects with restorable version history.
- Converting single files or batches to PDF quickly with MarkPDF.
- Keeping source content clean in Markdown while exporting publication-ready PDFs.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

Distributed under the terms of the [MIT license][license],
MarkTex is free and open source software.

## Issues & Support

If you encounter any problems:

- **[File an Issue](https://github.com/ahmadrazacdx/marktex/issues)**: Bug reports and feature requests
- **[Discussions](https://github.com/ahmadrazacdx/marktex/discussions)**: Questions and community support
- **[Documentation](https://github.com/ahmadrazacdx/marktex/tree/main/docs)**: Project docs and release notes

## AI Usage Disclosure

Parts of this project (code, docs, and release automation) are developed with AI assistance.
AI-assisted changes are reviewed and validated by the author before release.

---
If you find the tools useful in your work, please give the repo a 🌟 and share with your friends.
