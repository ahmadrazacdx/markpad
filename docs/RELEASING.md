# Releasing MarkPad

This guide documents the standard release flow so users install from GitHub Releases.

## Why Releases

GitHub Releases provide:

- Stable versioned download links
- Changelog visibility
- Source code tarball/zip attached automatically by GitHub
- Cleaner install experience for non-developers

## Recommended Release Process

1. Choose version (for example `0.1.1`).
2. Update app version in `artifacts/artifacts/markpad/src-tauri/tauri.conf.json`.
3. Commit and push to main.
4. Create and push a version tag (for example `v0.1.1`).
5. Wait for the `Desktop Windows Build` workflow to complete for that tag.
6. GitHub Release is created automatically and installer assets are uploaded.

## Signing and Trust (Recommended)

To reduce SmartScreen warnings:

1. Sign the installer with Authenticode.
2. Prefer EV code signing certificates.
3. Keep publisher identity consistent across releases.

## Suggested Release Notes Template

```markdown
## MarkPad vX.Y.Z

### Highlights
- ...

### Fixes
- ...

### Download
- Windows Installer: MarkPad_X.Y.Z_x64-setup.exe
```

## Manual Release (Fallback)

If automatic release publishing is unavailable, use GitHub CLI:

```bash
gh release create v0.1.1 \
  --title "MarkPad v0.1.1" \
  --notes "See changelog below" \
  ./path/to/installer.exe \
  ./path/to/installer.zip
```
