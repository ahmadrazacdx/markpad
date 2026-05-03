# Contributing to MarkTex

Thanks for your interest in improving MarkTex.

## Ground Rules

- Keep changes scoped and reviewable.
- Prefer small PRs over large multi-purpose PRs.
- Preserve existing architecture and coding conventions unless a change explicitly upgrades them.
- Add or update tests for behavior changes whenever practical.

## Development Setup

Prerequisites:

- Node.js 24+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

Useful commands:

```bash
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/marktex run dev
```

## Code Style

- TypeScript-first implementation.
- Keep functions focused and explicit.
- Avoid unrelated refactors in feature/fix PRs.
- Use descriptive commit messages.

## Pull Request Checklist

Before opening a PR:

1. Ensure typecheck passes.
2. Ensure build passes for changed packages.
3. Update docs when behavior/configuration changes.
4. Include clear PR description, rationale, and validation steps.

## Issue Reporting

When opening an issue, include:

- Environment (OS, Node, pnpm versions)
- Reproduction steps
- Expected behavior
- Actual behavior
- Logs/screenshots where relevant

## Security Reports

Do not post sensitive vulnerabilities publicly.

Open a private security report through GitHub Security Advisories, or contact the maintainers through repository owner channels.
