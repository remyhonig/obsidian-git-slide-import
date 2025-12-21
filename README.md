# Obsidian Plugin Template

A minimal starter template for Obsidian plugins with code quality tools configured.

## Getting Started

1. Clone/copy this template
2. Update `manifest.json` with your plugin id, name, description, and author
3. Update `package.json` name and description
4. Run `npm install`
5. Run `npm run dev` to start development with watch mode

## Development

```bash
npm install          # Install dependencies
npm run dev          # Build with watch mode
npm run build        # Production build (includes type checking)
npm run lint         # Run ESLint
npm test             # Run tests
npm version patch    # Bump version (updates manifest.json and versions.json)
```

## Project Structure

```
├── src/
│   ├── main.ts          # Plugin entry point
│   └── settings.ts      # Settings interface and tab
├── manifest.json        # Plugin metadata
├── versions.json        # Version to minAppVersion mapping
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── eslint.config.mts    # ESLint configuration
├── vitest.config.ts     # Test configuration
├── esbuild.config.mjs   # Build configuration
└── styles.css           # Plugin styles (optional)
```

## Testing in Obsidian

Copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/<plugin-id>/`, reload Obsidian, and enable in Settings → Community plugins.

## Release Artifacts

- `main.js` - bundled plugin code
- `manifest.json` - plugin metadata
- `styles.css` - styling (if needed)
