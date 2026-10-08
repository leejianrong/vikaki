import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = process.cwd();
const T = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
createServer(async (q, r) => {
  try {
    const p = new URL(q.url, "http://x").pathname;
    const f = normalize(join(root, p === "/" ? "index.html" : p));
    if (!f.startsWith(root)) return r.writeHead(403).end();
    r.writeHead(200, { "content-type": T[extname(f)] ?? "application/octet-stream" }).end(await readFile(f));
  } catch { r.writeHead(404).end(); }
}).listen(8801, "127.0.0.1", () => console.log("spike server on 8801"));
