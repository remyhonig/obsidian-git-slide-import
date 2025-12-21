# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian community plugin template. TypeScript source in `src/` is bundled into `main.js` using esbuild. The plugin runs inside Obsidian's Electron-based environment.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Build with watch mode (development)
npm run build        # Production build (includes type checking)
npm run lint         # Run ESLint
npm version patch    # Bump version (also updates manifest.json and versions.json)
```

## Architecture

- **Entry point**: `src/main.ts` → compiled to `main.js`
- **Settings**: `src/settings.ts` - settings interface, defaults, and settings tab
- **Build**: `esbuild.config.mjs` - bundles to CommonJS, externalizes Obsidian/CodeMirror APIs
- **Manifest**: `manifest.json` - plugin metadata (id, version, minAppVersion)
- **Version mapping**: `versions.json` - maps plugin versions to minimum Obsidian versions

## Key Patterns

- Plugin class extends `Plugin` from 'obsidian'
- Commands registered via `this.addCommand()` with stable IDs
- Settings persisted via `this.loadData()` / `this.saveData()`
- Use `this.register*` helpers for cleanup (registerEvent, registerDomEvent, registerInterval)
- External modules (obsidian, electron, @codemirror/*) are externalized in the bundle

## Code Organization Guidelines

- Keep `main.ts` minimal: lifecycle only (onload, onunload, command registration)
- Delegate feature logic to separate modules
- Split files exceeding ~200-300 lines into focused modules
- Never commit `node_modules/` or `main.js`

## Testing

Copy `main.js`, `manifest.json`, `styles.css` (if any) to `<Vault>/.obsidian/plugins/<plugin-id>/`, reload Obsidian, and enable in Settings → Community plugins.

## Release Artifacts

- `main.js` - bundled plugin code
- `manifest.json` - plugin metadata
- `styles.css` - optional styling

## Instructions
 
- Never work around the linter or add linter ignore comments. Fix the root cause in the code.
