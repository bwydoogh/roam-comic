# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- `Comic Strip: xkcd` in the command palette and the bullet context menu inserts a
  random xkcd comic: a title block with the image nested beneath it. It lands at
  the cursor, below the chosen bullet, or at the bottom of today's daily note.
- The image is uploaded to the graph's file storage, falling back to a link to the
  original.
- Setting: the tag added to each comic's title (default `comic`, empty for none).
- Cloudflare Worker (`worker/`) that serves one normalized comic per source.
