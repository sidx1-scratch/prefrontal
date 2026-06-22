const { spawn } = require("child_process");
const http = require("http");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts
    });

    p.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed with code ${code}`));
    });
  });
}

function wait(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + timeout;

    function check() {
      if (Date.now() > end) return reject(new Error("Timeout: " + url));

      http.get(url, res => {
        res.resume();
        resolve();
      }).on("error", () => setTimeout(check, 1000));
    }

    check();
  });
}

async function main() {
  console.log("🚀 CI starting...");

  // 1. Start static server
  console.log("Starting static server...");
  run("node", ["tests/static-server.js"]).catch(() => {});

  // 2. Start Ollama (if installed)
  console.log("Starting Ollama...");
  run("ollama", ["serve"]).catch(() => {});

  // 3. Wait for frontend
  console.log("Waiting for frontend...");
  await wait("http://localhost:3000");

  // 4. Wait for Ollama API
  console.log("Waiting for Ollama...");
  await wait("http://localhost:11434/api/tags");

  // 5. Run smoke tests
  console.log("Running smoke tests...");
  await run("node", ["tests/ci-smoke.js"]);

  console.log("✅ CI PASSED");
}

main().catch(err => {
  console.error("❌ CI FAILED");
  console.error(err);
  process.exit(1);
});
