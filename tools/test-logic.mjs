// Exercises the pure logic in extension.js and the Worker without a browser or
// a network: block-string building, tag formatting, caret spacing, upload-result
// parsing, and the Worker's routing with a stubbed fetch.
//
// The extension only exports { onload, onunload }, so this script builds a
// temporary module with the internals re-exported and imports that. Real Roam
// behaviour still has to be verified by hand; see DEVELOPMENT.md.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exposed = ["formatTag", "buildTitleString", "buildImageString", "textForCaret", "extractUploadUrl", "isComic", "fileNameFor", "SOURCES"];

const dir = mkdtempSync(join(tmpdir(), "roam-comic-test-"));
const harness = join(dir, "harness.mjs");
writeFileSync(harness, `${readFileSync(join(repoRoot, "extension.js"), "utf8")}\nexport { ${exposed.join(", ")} };\n`);

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
}

try {
  const ext = await import(pathToFileURL(harness).href);
  const worker = await import(pathToFileURL(join(repoRoot, "worker/src/index.js")).href);

  const comic = { source: "xkcd", title: "Barrel - Part 1", pageUrl: "https://xkcd.com/1/", imageUrl: "https://imgs.xkcd.com/comics/barrel_cropped_(1).jpg" };

  await test("formatTag", () => {
    assert.equal(ext.formatTag("comic"), "#comic");
    assert.equal(ext.formatTag("#comic"), "#comic");
    assert.equal(ext.formatTag("my comics"), "#[[my comics]]");
    assert.equal(ext.formatTag("[[my comics]]"), "#[[my comics]]");
    assert.equal(ext.formatTag("  "), "");
    assert.equal(ext.formatTag(""), "");
  });

  await test("buildTitleString and buildImageString", () => {
    assert.equal(ext.buildTitleString(comic, "comic"), "[xkcd: Barrel - Part 1](https://xkcd.com/1/) #comic");
    assert.equal(ext.buildTitleString({ ...comic, title: "a [b]" }, ""), "[xkcd: a (b)](https://xkcd.com/1/)");
    assert.equal(ext.buildImageString("https://firebase/x.jpg"), "![](https://firebase/x.jpg)");
  });

  await test("textForCaret", () => {
    assert.equal(ext.textForCaret("", 0, "X"), "X");
    assert.equal(ext.textForCaret("word", 4, "X"), " X");
    assert.equal(ext.textForCaret("word ", 5, "X"), "X");
    assert.equal(ext.textForCaret("a\nb", 2, "X"), "X");
  });

  await test("extractUploadUrl", () => {
    assert.equal(ext.extractUploadUrl("![](https://fb.example/a.png)"), "https://fb.example/a.png");
    assert.equal(ext.extractUploadUrl("https://fb.example/a.png"), "https://fb.example/a.png");
    assert.equal(ext.extractUploadUrl("nope"), null);
    assert.equal(ext.extractUploadUrl(undefined), null);
  });

  await test("isComic and fileNameFor", () => {
    assert.ok(ext.isComic(comic));
    assert.ok(!ext.isComic({ ...comic, imageUrl: "" }));
    assert.ok(!ext.isComic(null));
    assert.equal(ext.fileNameFor(comic, "image/jpeg"), "xkcd-barrel-part-1.jpg");
    assert.equal(ext.fileNameFor({ ...comic, imageUrl: "https://x/y" }, "image/png"), "xkcd-barrel-part-1.png");
  });

  await test("every extension source has a Worker route", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 500 });
    try {
      for (const source of ext.SOURCES) {
        const response = await worker.default.fetch(new Request(`https://w.dev/${source.id}`));
        assert.notEqual(response.status, 404, `no Worker route for ${source.id}`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("pickXkcdNumber stays in range and skips 404", () => {
    assert.equal(worker.pickXkcdNumber(500, () => 0), 1);
    assert.equal(worker.pickXkcdNumber(500, () => 0.999999), 500);
    const draws = [403 / 500, 0];
    assert.equal(worker.pickXkcdNumber(500, () => draws.shift()), 1);
  });

  await test("Worker /xkcd returns a normalized comic", async () => {
    const realFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      const body = String(url) === "https://xkcd.com/info.0.json"
        ? { num: 3 }
        : { num: 2, safe_title: "Petit Trees", title: "Petit Trees", img: "http://imgs.xkcd.com/comics/tree_cropped_(1).jpg" };
      return new Response(JSON.stringify(body));
    };
    const realRandom = Math.random;
    Math.random = () => 0.5;
    try {
      const response = await worker.default.fetch(new Request("https://w.dev/xkcd"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body = await response.json();
      assert.ok(ext.isComic(body));
      assert.deepEqual(body, {
        source: "xkcd",
        title: "Petit Trees",
        pageUrl: "https://xkcd.com/2/",
        imageUrl: "https://imgs.xkcd.com/comics/tree_cropped_(1).jpg",
      });
      assert.deepEqual(urls, ["https://xkcd.com/info.0.json", "https://xkcd.com/2/info.0.json"]);
    } finally {
      globalThis.fetch = realFetch;
      Math.random = realRandom;
    }
  });

  // Runs a route with fetch answered by `answer(url, init)`; returns the status, body and requested URLs.
  async function route(name, answer, random = () => 0.5) {
    const realFetch = globalThis.fetch;
    const realRandom = Math.random;
    const urls = [];
    globalThis.fetch = async (url, init) => {
      urls.push(String(url));
      return answer(String(url), init);
    };
    Math.random = random;
    try {
      const response = await worker.default.fetch(new Request(`https://w.dev/${name}`));
      return { status: response.status, body: await response.json(), urls };
    } finally {
      globalThis.fetch = realFetch;
      Math.random = realRandom;
    }
  }

  const proxy = (url) => `https://w.dev/image?u=${encodeURIComponent(url)}`;

  await test("pickSigmundDate picks a weekday before today, from June 2022 on", () => {
    const now = new Date(Date.UTC(2026, 9, 9, 12)); // a Friday
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.999999]) {
      const draws = [r, 0]; // a weekend day draws again; 0 is a Wednesday
      const date = worker.pickSigmundDate(now, () => draws.shift());
      assert.ok(date.getUTCDay() >= 1 && date.getUTCDay() <= 5, `${date.toISOString()} is a weekend day`);
      assert.ok(date.getTime() >= Date.UTC(2022, 5, 1));
      assert.ok(date.getTime() < Date.UTC(2026, 9, 9));
    }
    assert.equal(worker.pickSigmundDate(now, () => 0).toISOString().slice(0, 10), "2022-06-01");
    assert.equal(worker.pickSigmundDate(now, () => 0.999999).toISOString().slice(0, 10), "2026-10-08");
    const draws = [0.999999, 0];
    const later = new Date(Date.UTC(2026, 9, 11)); // a Sunday: yesterday is a Saturday, so it draws again
    assert.equal(worker.pickSigmundDate(later, () => draws.shift()).toISOString().slice(0, 10), "2022-06-01");
    assert.equal(worker.sigmundImageUrl(new Date(Date.UTC(2026, 8, 1))), "https://sigmund.nl/strips/sig260901.gif");
  });

  await test("Worker /sigmund skips a missing day and proxies the image", async () => {
    let calls = 0;
    const { status, body, urls } = await route("sigmund", () => new Response(null, { status: calls++ === 0 ? 404 : 200 }), () => 0);
    assert.equal(status, 200);
    assert.equal(urls.length, 2);
    assert.ok(ext.isComic(body));
    assert.equal(body.source, "Sigmund");
    assert.equal(body.pageUrl, "https://sigmund.nl/");
    assert.equal(body.title, "1 juni 2022");
    assert.equal(body.imageUrl, proxy(urls[1]));
  });

  await test("Worker /existential skips multi-image comics", async () => {
    const page = (images, title) => `<meta property="og:title" content="${title}" />
      <meta property="og:image" content="https://static.existentialcomics.com/comics/a.png" />
      ${'<img class="comicImg" src="x">'.repeat(images)}`;
    let pages = 0;
    const { status, body, urls } = await route("existential", (url) => {
      if (url === "https://existentialcomics.com/") return new Response('<a href="/comic/9">x</a><a href="/comic/12">x</a>');
      return new Response(pages++ === 0 ? page(3, "Split") : page(1, "Kant &amp; Hume"));
    });
    assert.equal(status, 200);
    assert.deepEqual(urls, ["https://existentialcomics.com/", "https://existentialcomics.com/comic/7", "https://existentialcomics.com/comic/7"]);
    assert.deepEqual(body, {
      source: "Existential Comics",
      title: "Kant & Hume",
      pageUrl: "https://existentialcomics.com/comic/7",
      imageUrl: proxy("https://static.existentialcomics.com/comics/a.png"),
    });
  });

  await test("Worker /smbc reads the page of a random slug", async () => {
    const { status, body } = await route("smbc", (url) => url.endsWith("rand.php")
      ? new Response('"last-wishes"')
      : new Response(`<title>Saturday Morning Breakfast Cereal - Last Wishes</title>
          <meta property="og:image" content="https://www.smbc-comics.com/comics/1.png" />`));
    assert.equal(status, 200);
    assert.deepEqual(body, {
      source: "SMBC",
      title: "Last Wishes",
      pageUrl: "https://www.smbc-comics.com/comic/last-wishes",
      imageUrl: proxy("https://www.smbc-comics.com/comics/1.png"),
    });
    const bad = await route("smbc", () => new Response('"../../evil"'));
    assert.equal(bad.status, 502);
    assert.equal(bad.urls.length, 1);
  });

  await test("Worker rejects unknown routes, bad methods and foreign image hosts", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("img", { headers: { "Content-Type": "image/png" } });
    try {
      assert.equal((await worker.default.fetch(new Request("https://w.dev/nope"))).status, 404);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/toString"))).status, 404);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/xkcd", { method: "POST" }))).status, 405);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/xkcd", { method: "OPTIONS" }))).status, 204);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/image?u=https://evil.example/a.png"))).status, 403);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/image?u=http://imgs.xkcd.com/a.png"))).status, 403);
      assert.equal((await worker.default.fetch(new Request("https://w.dev/image?u=nonsense"))).status, 400);
      for (const host of ["imgs.xkcd.com", "sigmund.nl", "static.existentialcomics.com", "www.smbc-comics.com"]) {
        const ok = await worker.default.fetch(new Request(`https://w.dev/image?u=https://${host}/a.png`));
        assert.equal(ok.status, 200, host);
        assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("Worker reports upstream failure as 502", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("down", { status: 503 });
    try {
      const response = await worker.default.fetch(new Request("https://w.dev/xkcd"));
      assert.equal(response.status, 502);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nall logic checks passed");
