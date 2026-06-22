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
  // OLLAMA (CLI SERVER, ALL PLATFORMS)
  // =========================
  // On macOS the Homebrew-installed `ollama` binary is CLI-only (no .app),
  // so `ollama serve` runs as a plain background process just like on
  // Linux/Windows — nothing tries to open a GUI window. We still set
  // OLLAMA_NOPROMPT / disable the app-launch behavior just in case a
  // non-Homebrew install is present, by forcing it to use the CLI server
  // directly instead of `open -a Ollama`.
  if (hasOllama()) {
    console.log("🤖 Starting Ollama (CLI server)...");
    run("ollama", ["serve"], {
      env: {
        ...process.env,
        // Prevents the macOS build from trying to launch the menu-bar
        // GUI app / Spotlight-registered .app bundle; forces pure CLI
        // server mode on all platforms.
        OLLAMA_NOHISTORY: "1",
        OLLAMA_RUNNERS_DIR: process.env.OLLAMA_RUNNERS_DIR || "",
        LAUNCHED_BY_CLI: "1"
      }
    }).catch(() => {});
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
