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

const IMAGE_HOSTS = new Set(["imgs.xkcd.com"]);

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

export function pickXkcdNumber(latest, random = Math.random) {
  for (;;) {
    const n = 1 + Math.floor(random() * latest);
    if (!XKCD_MISSING.has(n)) return n;
  }
}

async function xkcd() {
  const { num: latest } = await fetchJson("https://xkcd.com/info.0.json", 3600);
  const n = pickXkcdNumber(latest);
  // A published comic never changes, so it is cached for a year.
  const comic = await fetchJson(`https://xkcd.com/${n}/info.0.json`, 31536000);
  return {
    source: "xkcd",
    title: comic.safe_title || comic.title,
    pageUrl: `https://xkcd.com/${n}/`,
    imageUrl: comic.img.replace(/^http:/, "https:"),
  };
}

const SOURCES = { xkcd };

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
  const upstream = await fetch(target, { cf: { cacheTtl: 31536000, cacheEverything: true } });
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
      return json(await source());
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 502);
    }
  },
};
