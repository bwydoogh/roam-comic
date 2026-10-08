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
      const ok = await worker.default.fetch(new Request("https://w.dev/image?u=https://imgs.xkcd.com/a.png"));
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");
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
