#!/usr/bin/env node
/**
 * static-server.js
 *
 * A minimal static file server used in place of `npx -y serve`.
 *
 * Why: `serve` is invoked via npx, which on Windows resolves to a .cmd/.ps1
 * shim rather than a real executable. Those shims need `shell: true` to
 * spawn, which complicates reliably detaching a background process across
 * platforms (see start-background.js). Running plain `node` avoids that
 * entirely, since node.exe is a real executable on every platform.
 *
 * If your app isn't a plain static site (e.g. it needs a build step or a
 * real backend), swap the command this is invoked with in the workflow.
 *
 * Usage: node scripts/static-server.js [port] [rootDir]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2] || 3000);
const root = path.resolve(process.argv[3] || ".");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let filePath = path.join(root, urlPath);

    // Guard against path traversal outside of `root`.
    if (!filePath.startsWith(root)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (filePath.endsWith(path.sep)) {
      filePath = path.join(filePath, "index.html");
    }

    fs.stat(filePath, (statErr, stats) => {
      if (statErr) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      if (stats.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }

      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal error");
  }
});

server.listen(port, () => {
  console.log(`Static server listening on port ${port}, serving ${root}`);
});

server.on("error", (err) => {
  console.error(`Static server failed to start: ${err.message}`);
  process.exit(1);
});
