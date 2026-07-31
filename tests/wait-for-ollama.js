#!/usr/bin/env node
/*
 * Prefrontal — Powered by AI
 * Copyright (C) 2026 sidx1-scratch
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
/**
 * wait-for-ollama.js
 *
 * Polls Ollama's /api/tags endpoint until it returns valid JSON, or exits
 * non-zero after a timeout. See wait-for-port.js for why this is a real
 * script file instead of an inline `shell: node` step.
 *
 * Usage:
 *   node scripts/wait-for-ollama.js --port 11434 --timeout 60000
 */
const http = require("http");

function parseArgs(argv) {
  const opts = { port: 11434, timeoutMs: 60000, intervalMs: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]);
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--interval") opts.intervalMs = Number(argv[++i]);
  }
  return opts;
}

function checkOnce(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "localhost", port, path: "/api/tags", timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          JSON.parse(body);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const deadline = Date.now() + opts.timeoutMs;

  while (Date.now() < deadline) {
    if (await checkOnce(opts.port)) {
      console.log("✅ Ollama API ready");
      return;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }

  console.error(`❌ Ollama API did not become ready on port ${opts.port} within ${opts.timeoutMs}ms`);
  process.exit(1);
}

main();
