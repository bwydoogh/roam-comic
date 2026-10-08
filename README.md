# Comic Strip

Drop a comic into your graph in one command.

Open the command palette and run **Comic Strip: xkcd**. You get one block like this:

```text
[xkcd: Bag Check](https://xkcd.com/651/) #comic ![](https://firebasestorage.../bag-check.png)
```

Every run brings up a different comic.

## Where it lands

- **Editing a block:** at the cursor.
- **Bullet menu:** right-click a bullet, open **Plugins** and choose
  **Comic Strip: xkcd**. The comic goes into a new block right below that one.
- **Otherwise:** at the bottom of today's daily note.

## Settings

- **Tag**: added to every comic block. Defaults to `comic`. Leave it empty if you
  don't want a tag.

## Notes

- The image is uploaded into your graph's own file storage, so it stays even if the
  source site removes it. If the upload fails, the block links to the original
  image instead.
- **Network:** this extension calls `roam-comic.bwydoogh.workers.dev`, a small
  Cloudflare Worker run by the author. It fetches the comic's title and image
  address from the source site (xkcd's API can't be called from a browser) and
  sends nothing about you or your graph. Images are downloaded from the source site
  (`imgs.xkcd.com`).
- Comics belong to their creators. xkcd is by Randall Munroe, licensed
  [CC BY-NC 2.5](https://xkcd.com/license.html).

## License

MIT
