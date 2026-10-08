import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const preferredPort = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function send(response, status, body, type = "text/plain; charset=utf-8", includeBody = true) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": type,
  });
  response.end(includeBody ? body : undefined);
}

function resolveRequestPath(url) {
  const requestUrl = new URL(url, `http://${host}:${preferredPort}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(root, `.${normalized}`);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  return filePath;
}

function handleRequest(request, response) {
  const includeBody = request.method !== "HEAD";

  if (request.method === "OPTIONS") {
    send(response, 204, "", "text/plain; charset=utf-8", includeBody);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed", "text/plain; charset=utf-8", includeBody);
    return;
  }

  const filePath = resolveRequestPath(request.url);

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    send(response, 404, "Not found", "text/plain; charset=utf-8", includeBody);
    return;
  }

  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": types.get(extname(filePath)) || "application/octet-stream",
  });

  if (includeBody) {
    createReadStream(filePath).pipe(response);
    return;
  }

  response.end();
}

function listen(port, attemptsRemaining = 10) {
  const server = createServer(handleRequest);

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsRemaining > 0) {
      listen(port + 1, attemptsRemaining - 1);
      return;
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.log(`Comic Strip dev server: http://localhost:${port}/extension.js`);
  });
}

listen(preferredPort);
