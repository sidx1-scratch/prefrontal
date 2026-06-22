const { spawn, spawnSync } = require("child_process");
const http = require("http");

const children = [];

function run(cmd, args) {
  const p = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
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

function hasOllama() {
  try {
    const r = spawnSync("ollama", ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32"
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function cleanup() {
  console.log("🧹 Cleaning up processes...");

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
  // OLLAMA (SKIP MACOS)
  // =========================
  const isMac = process.platform === "darwin";

  if (isMac) {
    console.log("⚠️ macOS CI: Ollama is unstable and skipped");
  } else if (hasOllama()) {
    console.log("🤖 Starting Ollama...");
    run("ollama", ["serve"]).catch(() => {});

    await waitFor("http://localhost:11434/api/tags");

    console.log("📦 Pulling model...");
    await run("ollama", ["pull", "llama3.2:1b"]);

    console.log("⏳ Model warmup...");
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log("⚠️ Ollama not found — skipping AI tests");
  }

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
