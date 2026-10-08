# Development

Comic Strip is a Roam Depot-ready extension backed by a Cloudflare Worker. The public
`README.md` is written for Roam Depot users; this file has the local development,
test and release notes.

## Files

- `extension.js` holds the whole runtime. There is no build step, so this file is the shipped artifact.
- `worker/` is the Cloudflare Worker (`src/index.js`, `wrangler.toml`). It is deployed separately and is not part of the Depot release.
- `tools/test-logic.mjs` runs browser-free checks for the extension's pure logic and for the Worker's routing.
- `dev-server.mjs` is a dependency-free local server with CORS headers.

## Commands

```sh
npm run check          # syntax checks + logic checks (no network)
npm run test           # logic checks only
npm run dev            # serve extension.js on http://localhost:8787 with CORS
npm run worker:dev     # run the Worker locally with wrangler
npm run worker:deploy  # deploy the Worker to Cloudflare
git diff --check       # required pre-commit whitespace check
```

## Worker

First time: `cd worker && npx wrangler login`, then `npm run worker:deploy`. The
deploy prints the URL. It must match `WORKER_URL` in `extension.js` and the network
note in `README.md`.

Smoke test after a deploy:

```sh
curl -s https://roam-comic.benny-wydooghe.workers.dev/xkcd
```

## Adding a source

1. Write a handler in `worker/src/index.js` that returns `{ source, title, pageUrl, imageUrl }`
   and add it to `SOURCES` there. If the source's image host sends no CORS header,
   add the host to `IMAGE_HOSTS` and return
   `${origin}/image?u=${encodeURIComponent(img)}` as `imageUrl`.
2. Deploy the Worker.
3. Add `{ id, label }` to `SOURCES` in `extension.js`. `npm run check` fails if an
   extension source has no Worker route.
4. Release the extension.

## Local test in Roam

Run `npm run dev`. In Roam Depot development mode, choose `Load extension from URL`
and enter `http://localhost:8787/extension.js`, or load this folder with the folder
picker.

## Manual test checklist

1. **At the cursor.** Type `hello` in a block, run `Comic Strip: xkcd` from the
   palette. The block reads `hello [xkcd: …](…) #comic` and its first child holds
   the image. Unsaved text typed just before running the command survives.
2. **Uploaded.** The image URL points at Roam's file storage, not `imgs.xkcd.com`.
3. **Bullet menu.** Right-click a bullet → Plugins → `Comic Strip: xkcd`. A new
   title block appears directly below it, at the same level, with the image nested
   under it.
4. **Daily note.** With no block in edit mode, run the palette command. The comic
   goes to the bottom of today's daily note and a notice says so, even when that note
   did not exist yet.
5. **Tag.** Set the tag to `my comics` and the title gets `#[[my comics]]`. With an
   empty tag the title gets no tag at all.
6. **Failure.** Change `WORKER_URL` to a bad host. A notice explains the failure and
   nothing is written.
7. **Unload.** Disable the extension. The palette and bullet-menu commands are gone.

## Release

1. Deploy the Worker first if it changed.
2. Test a pushed commit through jsDelivr:
   `https://cdn.jsdelivr.net/gh/bwydoogh/roam-comic@COMMIT_SHA/extension.js`.
3. Move the `[Unreleased]` changelog entries under the new version.
4. Open a PR to `Roam-Research/roam-depot` that adds
   `extensions/bwydoogh/roam-comic.json` with `name` ("Comic Strip"),
   `short_description`, `author` ("Benny Wydooghe"), `tags`, `source_url`,
   `source_repo` and `source_commit`.
