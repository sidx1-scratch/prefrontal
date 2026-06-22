const { spawn, spawnSync } = require("child_process");
const http = require("http");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

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
        return reject(new Error(`Timeout waiting for ${url}`));
      }

      http.get(url, res => {
        res.resume();
        resolve();
      }).on("error", () => setTimeout(check, 1500));
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

async function main() {
  console.log("🚀 CI START");

  // =========================
  // 1. START FRONTEND (REAL APP)
  // =========================
  console.log("Starting frontend (npm start)...");
  run("npm", ["start"]).catch(() => {});

  // =========================
  // 2. WAIT FRONTEND
  // =========================
  await waitFor("http://localhost:3000");

  // =========================
  // 3. OLLAMA SETUP
  // =========================
  if (hasOllama()) {
    console.log("Starting Ollama...");
    run("ollama", ["serve"]).catch(() => {});

    console.log("Waiting for Ollama API...");
    await waitFor("http://localhost:11434/api/tags");

    console.log("Pulling model (llama3.2:1b)...");
    await run("ollama", ["pull", "llama3.2:1b"]);

    console.log("Waiting for model to stabilize...");
    await sleep(5000);
  } else {
    console.log("⚠️ Ollama not found — skipping AI tests");
  }

  // =========================
  // 4. RUN TESTS
  // =========================
  console.log("Running smoke tests...");
  await run("node", ["tests/ci-smoke.js"]);

  console.log("✅ CI PASSED");
}

main().catch(err => {
  console.error("❌ CI FAILED");
  console.error(err);
  process.exit(1);
});
