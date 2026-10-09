# Comic Strip

Drop a comic into your graph in one command.

Open the command palette and run one of the commands below. You get a title with
the image nested beneath it:

```text
- [xkcd: Bag Check](https://xkcd.com/651/) #comic
    - ![](https://firebasestorage.../bag-check.png)
```

Every run brings up a different, random comic.

| Command | Comic |
| --- | --- |
| **Comic Strip: xkcd** | [xkcd](https://xkcd.com) |
| **Comic Strip: Sigmund** | [Sigmund](https://sigmund.nl) (Dutch), a weekday strip from mid-2022 on |
| **Comic Strip: Existential Comics** | [Existential Comics](https://existentialcomics.com) |
| **Comic Strip: SMBC** | [Saturday Morning Breakfast Cereal](https://www.smbc-comics.com) |

## Where it lands

- **Editing a block:** the title at the cursor, the image as the block's first child.
- **Bullet menu:** right-click a bullet, open **Plugins** and choose
  a **Comic Strip** command. The comic goes into a new block right below that one.
- **Otherwise:** at the bottom of today's daily note.

## Settings

- **Tag**: added to every comic's title. Defaults to `comic`. Leave it empty if you
  don't want a tag.

## Notes

- The image is uploaded into your graph's own file storage, so it stays even if the
  source site removes it. If the upload fails, the block links to the image on the
  web instead.
- **Network:** this extension calls `roam-comic.benny-wydooghe.workers.dev`, a small
  Cloudflare Worker run by the author. It fetches the comic's title and image
  address from the source site (most of them can't be called from a browser) and
  sends nothing about you or your graph. xkcd images are downloaded straight from
  `imgs.xkcd.com`. Images from Sigmund, Existential Comics and SMBC pass through the
  same Worker, because those sites don't allow a browser to download them for upload.
- Comics belong to their creators. xkcd is by Randall Munroe, licensed
  [CC BY-NC 2.5](https://xkcd.com/license.html). Sigmund is by Peter de Wit.
  Existential Comics is by Corey Mohler. SMBC is by Zach Weinersmith.

## License

MIT
