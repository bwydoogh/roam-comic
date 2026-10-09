// Cloudflare Worker behind the Comic Strip extension.
//
// Each source is a route that returns one comic as
// { source, title, pageUrl, imageUrl }. The extension only displays and uploads;
// everything that knows about a particular site lives here, so a source that
// breaks is fixed with a Worker deploy instead of a Roam Depot release.
//
// /image?u=... proxies images from hosts in IMAGE_HOSTS, for sources whose image
// server sends no CORS header (the extension needs CORS to upload the image).

const XKCD_MISSING = new Set([404]); // xkcd skipped #404 on purpose

const IMAGE_HOSTS = new Set(["imgs.xkcd.com", "sigmund.nl", "static.existentialcomics.com", "www.smbc-comics.com"]);

const YEAR = 31536000;
const TRIES = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function fetchJson(url, cacheTtl) {
  const response = await fetch(url, { cf: { cacheTtl, cacheEverything: true } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function fetchText(url, cacheTtl) {
  const response = await fetch(url, { cf: { cacheTtl, cacheEverything: true } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function metaContent(html, property) {
  const tag = html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*>`, "i"))?.[0];
  const content = tag?.match(/content="([^"]*)"/i)?.[1];
  return content == null ? null : decodeEntities(content);
}

function proxied(origin, url) {
  return `${origin}/image?u=${encodeURIComponent(url)}`;
}

export function pickNumber(latest, random = Math.random, missing = new Set()) {
  for (;;) {
    const n = 1 + Math.floor(random() * latest);
    if (!missing.has(n)) return n;
  }
}

export function pickXkcdNumber(latest, random = Math.random) {
  return pickNumber(latest, random, XKCD_MISSING);
}

async function xkcd() {
  const { num: latest } = await fetchJson("https://xkcd.com/info.0.json", 3600);
  const n = pickXkcdNumber(latest);
  // A published comic never changes, so it is cached for a year.
  const comic = await fetchJson(`https://xkcd.com/${n}/info.0.json`, YEAR);
  return {
    source: "xkcd",
    title: comic.safe_title || comic.title,
    pageUrl: `https://xkcd.com/${n}/`,
    imageUrl: comic.img.replace(/^http:/, "https:"),
  };
}

// Sigmund appears Monday to Friday. The site keeps strips from 2022 on, under a
// URL built from the date, and has no page per strip.
const SIGMUND_FIRST = Date.UTC(2022, 5, 1);
const DAY = 86400000;

export function pickSigmundDate(now = new Date(), random = Math.random) {
  const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY;
  const days = Math.floor((yesterday - SIGMUND_FIRST) / DAY) + 1;
  for (;;) {
    const date = new Date(SIGMUND_FIRST + Math.floor(random() * days) * DAY);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) return date;
  }
}

export function sigmundImageUrl(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `https://sigmund.nl/strips/sig${two(date.getUTCFullYear() % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}.gif`;
}

async function sigmund(origin) {
  for (let i = 0; i < TRIES; i += 1) {
    const date = pickSigmundDate();
    const url = sigmundImageUrl(date);
    // A missing day (a holiday) is cached for a day only, in case it shows up later.
    const response = await fetch(url, { method: "HEAD", cf: { cacheTtlByStatus: { "200-299": YEAR, "404": 86400 } } });
    if (!response.ok) continue;
    return {
      source: "Sigmund",
      title: date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
      pageUrl: "https://sigmund.nl/",
      imageUrl: proxied(origin, url),
    };
  }
  throw new Error("No Sigmund strip found");
}

async function existential(origin) {
  const home = await fetchText("https://existentialcomics.com/", 3600);
  const latest = Math.max(...[...home.matchAll(/comic\/(\d+)/g)].map((m) => Number(m[1])));
  if (!Number.isFinite(latest)) throw new Error("No Existential Comics number found");
  for (let i = 0; i < TRIES; i += 1) {
    const pageUrl = `https://existentialcomics.com/comic/${pickNumber(latest)}`;
    const html = await fetchText(pageUrl, YEAR);
    // Some comics are split over several images; those do not fit in one block.
    if ((html.match(/class="comicImg"/g) ?? []).length !== 1) continue;
    const title = metaContent(html, "og:title");
    const img = metaContent(html, "og:image");
    if (!title || !img) continue;
    return { source: "Existential Comics", title, pageUrl, imageUrl: proxied(origin, img) };
  }
  throw new Error("No single-image Existential Comics comic found");
}

async function smbc(origin) {
  const slug = await fetchJson("https://www.smbc-comics.com/rand.php", 0);
  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) throw new Error("Unexpected SMBC slug");
  const pageUrl = `https://www.smbc-comics.com/comic/${slug}`;
  const html = await fetchText(pageUrl, YEAR);
  const img = metaContent(html, "og:image");
  const title = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "")
    .replace(/^Saturday Morning Breakfast Cereal\s*-\s*/, "")
    .trim();
  if (!img) throw new Error("No SMBC image found");
  return { source: "SMBC", title: title || slug, pageUrl, imageUrl: proxied(origin, img) };
}

const SOURCES = { xkcd, sigmund, existential, smbc };

async function image(url) {
  let target;
  try {
    target = new URL(url ?? "");
  } catch {
    return json({ error: "Bad image URL" }, 400);
  }
  if (target.protocol !== "https:" || !IMAGE_HOSTS.has(target.hostname)) {
    return json({ error: "Image host not allowed" }, 403);
  }
  const upstream = await fetch(target, { cf: { cacheTtl: YEAR, cacheEverything: true } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/+|\/+$/g, "");

    if (name === "image") return image(url.searchParams.get("u"));

    const source = Object.hasOwn(SOURCES, name) ? SOURCES[name] : null;
    if (!source) return json({ error: "Unknown source" }, 404);

    try {
      return json(await source(url.origin));
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 502);
    }
  },
};
