# Git Slide Import

Create presentation slides from git commits. Built for software engineers who present code.

## The Problem

You're preparing a talk or demo where you need to walk through code changes. Maybe you're:

- Explaining a new feature to your team
- Teaching a workshop on a framework
- Presenting a code review or architecture decision
- Creating a tutorial that shows code evolving step by step

Manually copying code snippets into slides is tedious. Screenshots get outdated. And you lose the context of *what changed* between steps.

## The Solution

Git Slide Import lets you select commits from any git repository and generates reveal.js-compatible slides showing the code changes. Each commit becomes a slide (or group of slides) with syntax-highlighted diffs.

Use it with [Advanced Slides](https://github.com/MSzturc/obsidian-advanced-slides) to present directly from Obsidian.

## Features

- **Browse any git repository** - Select a local repo and filter by branch, date range, or file patterns
- **Cherry-pick commits and files** - Choose exactly which changes to include
- **Multiple slide layouts** - Flat (one slide per file), grouped by commit, progressive (same file evolving), or per-hunk
- **Syntax highlighting** - Automatic language detection with line highlights on added code
- **Live preview** - See your slides as you build them
- **Customizable templates** - Control the slide structure with template variables

## How It Works

1. Open the Git Slide Import view from the command palette
2. Select a git repository
3. Pick the commits and files you want to present
4. Adjust formatting options (highlight style, context lines, organization)
5. Copy the generated markdown to your note

The output is standard reveal.js markdown that works with Advanced Slides.

## Example Output

```markdown
<!-- slide -->
## Add user authentication

`src/auth/login.ts`

```ts {4-8}
import { hash } from 'bcrypt';

export async function login(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user) throw new Error('User not found');
  const valid = await compare(password, user.passwordHash);
  if (!valid) throw new Error('Invalid password');
  return createSession(user);
}
`` `
```

## Requirements

- A local git repository
- [Advanced Slides](https://github.com/MSzturc/obsidian-advanced-slides) plugin (for presenting)

## Installation

### Using BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) if you haven't already
2. Open Settings → BRAT → Add Beta Plugin
3. Enter the repository URL: `remyhonig/obsidian-git-slide-import`
4. Click "Add Plugin" and enable it

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder: `<vault>/.obsidian/plugins/git-slide-import/`
3. Copy the files into that folder
4. Reload Obsidian and enable the plugin

## Usage Tips

- Use the **Preset** dropdown to quickly filter files for common frameworks (React, Python, Go, etc.)
- The **Progressive** organization is great for showing how a single file evolves across commits
- **Per-hunk** organization works well when commits have multiple distinct changes
- Adjust **Context lines** to show more or less surrounding code
