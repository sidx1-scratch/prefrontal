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
 * wait-for-port.js
 *
 * Polls one or more localhost ports until one of them responds to an HTTP
 * request, or exits non-zero after a timeout.
 *
 * This replaces an inline script that was set to run with `shell: node` in
 * the workflow. GitHub Actions only recognizes a fixed set of built-in
 * shells (bash, pwsh, python, sh, cmd, powershell); anything else must be
 * given as a command template ending in `{0}` (e.g. `node {0}`), and even
 * then the runner has to guess the right file extension for the temp
 * script. Shipping this as a real .js file invoked as `node scripts/wait-for-port.js`
 * sidesteps all of that.
 *
 * Usage:
 *   node scripts/wait-for-port.js --ports 3000,3001 --timeout 60000 --label frontend
 */
const http = require("http");

function parseArgs(argv) {
  const opts = { ports: [3000], timeoutMs: 60000, intervalMs: 1000, label: "service" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ports") opts.ports = argv[++i].split(",").map(Number);
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--interval") opts.intervalMs = Number(argv[++i]);
    else if (a === "--label") opts.label = argv[++i];
  }
  return opts;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "localhost", port, timeout: 2000 }, (res) => {
      res.resume(); // drain so the socket can close cleanly
      resolve(true);
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
    for (const port of opts.ports) {
      if (await checkPort(port)) {
        console.log(`✅ ${opts.label} is up on port ${port}`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }

  console.error(`❌ ${opts.label} did not respond on ports [${opts.ports.join(", ")}] within ${opts.timeoutMs}ms`);
  process.exit(1);
}

main();
