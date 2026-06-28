# Contributing to YouTube Zero

Thanks for your interest in improving ytzero! This is a personal, self-hosted
project, so contributions are welcome but kept lightweight. Please read this
guide before opening an issue or pull request.

## Ways to contribute

- **Report bugs** — open an [issue](../../issues) with steps to reproduce, what
  you expected, and what happened.
- **Suggest features** — open an issue describing the use case and why it would
  be useful.
- **Submit code** — fix a bug or implement an agreed-upon feature via a pull
  request (see below).

For anything non-trivial, please open an issue first so we can agree on the
approach before you spend time on a PR.

## Project layout

```text
app/      # Backend — Hono on Bun, TypeScript (runtime, no build step)
ui/       # Frontend — React + Vite + TypeScript
scripts/  # setup / dev / build / start helpers
data/     # Local runtime data (SQLite + image cache), gitignored
```

The backend is TypeScript executed directly by Bun. The frontend is built with
Vite, and in production the backend serves the static files from `ui/dist`.

## Prerequisites

- [Bun](https://bun.sh) (the only required toolchain — no Node.js needed)
- Optionally Docker, if you want to test the container build

## Getting started

```bash
# Install dependencies for both app/ and ui/
bun run setup

# Run backend (:3001) and frontend (:5173) together with hot reload
bun run dev
```

- UI dev server: <http://localhost:5173>
- API: <http://localhost:3001>

You can also run the halves separately with `bun run dev:app` and
`bun run dev:ui`.

To test a production-like build locally:

```bash
bun run build   # builds ui/dist
bun run start   # backend serves ui/dist on :3001
```

## Before you open a PR

Run the same checks CI runs, so nothing breaks after merge:

```bash
# Type-check both packages
cd app && bunx tsc --noEmit
cd ../ui && bunx tsc --noEmit

# Build the frontend
bun run build
```

Both packages use `strict` TypeScript — please keep the build type-clean.

## Pull request workflow

`main` is protected. All changes go through a pull request:

1. Branch off `main` (e.g. `fix/live-detection`, `feat/playlist-import`).
2. Make your change and keep commits focused.
3. Make sure type-checks and the build pass locally.
4. Open a PR against `main` with a clear description of *what* and *why*.

Notes:

- PRs are **squash-merged**, so the final commit on `main` is your PR title and
  description. A clean per-commit history on your branch is appreciated but not
  required — it gets squashed anyway.
- History on `main` is linear; force-pushes and direct pushes to `main` are
  blocked.

## Coding style

- Match the surrounding code — naming, structure, and comment density.
- Keep changes scoped; avoid unrelated refactors in the same PR.
- User-facing UI text is translated via `ui/src/i18n.tsx`. When you add new
  copy, provide a string for **every** language defined there (the `Language`
  type lists the currently supported locales) so no language falls back to a
  missing key.
- Use icons from `lucide-react` rather than emoji in the UI.

## License

By contributing, you agree that your contributions are licensed under the
project's **GNU Affero General Public License v3.0 only**
([`AGPL-3.0-only`](https://www.gnu.org/licenses/agpl-3.0.html)), the same
license as the rest of the project. See the full text in [LICENSE](LICENSE).
