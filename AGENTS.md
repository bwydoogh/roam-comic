# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

- `npm run check` is the gate. It runs `node --check` on all three sources and then `tools/test-logic.mjs`. It needs no browser and no network.
- `npm run test` runs the logic checks only.
- `npm run dev` serves `extension.js` on `http://localhost:8787` with CORS, for `Load extension from URL`.
- `npm run worker:deploy` deploys `worker/` with `npx wrangler`.
- `git diff --check` is the required pre-commit whitespace check.

## Architecture

There are two parts.

- **`extension.js`** is a single file with no bundler and no dependencies, because Roam
  Depot publishes only `extension.js` and `extension.css`. It is edited directly. It
  calls the Worker, uploads the image with `roamAlphaAPI.file.upload` and writes a
  title block with the image as its first child.
- **`worker/src/index.js`** is a Cloudflare Worker. Each source is a route
  (`GET /xkcd`) that returns `{ source, title, pageUrl, imageUrl }`. All site-specific
  knowledge lives here: APIs, scraping, the random pick. `GET /image?u=` proxies images
  from hosts in `IMAGE_HOSTS` for sources without CORS on their images.

Keep it simple. This is deliberately a one-command-per-source extension, with no
number picker, no "latest" option and no alt text. The user chose that scope.

### Things that are easy to get wrong

- **Edit mode goes through `execCommand("insertText")`.** The editing textarea holds
  unsaved text. Never assign `textarea.value` and never `block.update` that block. The
  context-menu path creates a *new* sibling block via the API instead, which is safe.
  The image child is always created via the API, also under the edited block —
  creating a child does not touch the parent's string.
- **Re-resolve the target after the fetch.** The fetch and upload take a moment, and the
  user may have left the block in the meantime. `insertComic` looks up the textarea
  again afterwards and falls back to inserting after the block, then to the daily note.
- **An empty tag is a valid setting.** It means "no tag". Only `null` or `undefined`
  falls back to `comic`.
- **Upload failure must never lose the comic.** `storeImage` returns the original
  `imageUrl` on any error.
- **The source lists must stay in sync.** `SOURCES` in `extension.js` and `SOURCES` in
  the Worker are separate lists. The test fails when an extension source has no
  Worker route.
- **Look up sources with `Object.hasOwn`.** Without it `/toString` would resolve to a
  prototype method.
- **Reach the API through `roamAPI()`.** The test imports the module in Node, where
  `window` is undefined.
- **Cleanup is idempotent.** Depot dev mode reloads without `onunload`, so `onload`
  first runs the previous cleanup from `window.__roamComicCleanup`.

## Testing

`tools/test-logic.mjs` re-exports the internals of `extension.js` from a temporary
copy and imports the Worker directly, with `fetch` stubbed. The Roam writes,
`execCommand` and upload are browser-only. The checklist in `DEVELOPMENT.md` is the
source of truth for those.

## Release

The Worker deploys independently of the extension. Releases of the extension are
pinned commits referenced from `extensions/bwydoogh/roam-comic.json` in
`Roam-Research/roam-depot`. See `DEVELOPMENT.md`.
