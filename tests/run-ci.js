const { spawn, spawnSync } = require("child_process");
const http = require("http");
const children = [];

function run(cmd, args, opts = {}) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts
  });
  children.push(p);
  return new Promise((resolve, reject) => {
    p.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed (${code})`));
    });
  });
}

function waitFor(url, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + timeout;
    function check() {
      if (Date.now() > end) {
        return reject(new Error(`Timeout: ${url}`));
      }
      http.get(url, res => {
        res.resume();
        resolve();
      }).on("error", () => setTimeout(check, 1200));
    }
    check();
  });
}

function cleanup() {
  console.log("清理 Cleaning up processes...");
  for (const p of children) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

async function main() {
  console.log("🚀 CI START");

  // =========================
  // FRONTEND (REAL APP)
  // =========================
  console.log("Starting frontend (npm start)...");
  run("npm", ["start"]).catch(() => {});
  await waitFor("http://localhost:3000");

  // =========================
  // OLLAMA (PULL & WARMUP)
  // =========================
  // The server is already started automatically by ai-action/setup-ollama.
  // We simply verify availability, pull the model, and warm it up.
  console.log("📦 Pulling model...");
  await run("ollama", ["pull", "llama3.2:1b"]);
  console.log("⏳ Model warmup...");
  await new Promise(r => setTimeout(r, 5000));

  // =========================
  // TESTS
  // =========================
  console.log("Running tests...");
  await run("node", ["tests/ci-smoke.js"]);
  console.log("✅ CI PASSED");
  cleanup();
  process.exit(0);
}

main().catch(err => {
  console.error("❌ CI FAILED");
  console.error(err);
  cleanup();
  process.exit(1);
});
