# MarkPad

## Overview

MarkPad is a local-first Markdown writing app — "Overleaf for people who think in Markdown." It features a three-pane layout with a project sidebar, CodeMirror 6 markdown editor, and live PDF preview powered by pandoc + typst.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: SQLite (local file via libSQL client) + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS
- **Editor**: CodeMirror 6 with markdown language support
- **PDF Preview**: pdfjs-dist rendering to canvas
- **PDF Engine**: pandoc + typst (installed as system dependencies)
- **Real-time**: WebSocket for live markdown-to-PDF preview

## Architecture

### Frontend (artifacts/markpad)
- Three-pane layout: sidebar, editor, PDF preview
- CodeMirror 6 with markdown syntax highlighting
- PDF.js renders PDF pages into stacked canvases
- WebSocket sends markdown on keystroke (300ms debounce), receives PDF bytes
- Dark/light mode toggle
- Project management sidebar with file tree
- Version history panel with restore/pin functionality

### Backend (artifacts/api-server)
- Express 5 API server with WebSocket support
- Project CRUD: create, list, rename, delete projects
- File management: create, read, update, delete files (stored in PostgreSQL)
- Version history: automatic snapshots on save with pruning
- PDF rendering via pandoc + typst subprocess
- Export: PDF, Markdown, LaTeX formats
- Templates: Plain, Academic, Report, Letter

### Database Schema (lib/db)
- **projects**: id, name, template, timestamps
- **files**: id, project_id (FK), path, name, content, timestamps
- **snapshots**: id, project_id (FK), file_path, content, word_count, label, created_at

### Version History
- Automatic snapshots on every file save
- Pruning: keep all pinned, all from last 7 days, one-per-day for older, cap at 500
- Before restore: auto-saves current state as labeled snapshot
- Grouped by: pinned, today, yesterday, older

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/markpad run dev` — run frontend dev server

## System Dependencies

- **pandoc** (v3.6) — Markdown to PDF/LaTeX conversion
- **typst** (v0.13.1) — PDF typesetting engine used by pandoc

## Desktop Build (Windows First)

- **Desktop shell**: Tauri 2 (native WebView, lightweight)
- **Installer target**: NSIS `.exe`
- **Workflow**: `.github/workflows/desktop-windows.yml`

The Windows CI workflow runs on every push and produces downloadable installer artifacts in GitHub Actions.

Local desktop build steps:

1. `pnpm --filter @workspace/api-server run build`
2. `pnpm --filter @workspace/markpad run build:desktop:web`
3. Place a full Node runtime folder (including `node.exe` and its DLLs) into `artifacts/artifacts/markpad/src-tauri/resources/runtime/node/`
4. Place `pandoc.exe` and `typst.exe` into `artifacts/artifacts/markpad/src-tauri/resources/bin/`
5. `pnpm --filter @workspace/markpad run prepare:desktop:resources`
6. `pnpm --filter @workspace/markpad run tauri:build:windows`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
