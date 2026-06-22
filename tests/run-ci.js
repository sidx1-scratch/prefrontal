const { spawn, spawnSync } = require("child_process");
const http = require("http");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    p.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed`));
    });
  });
}

function hasOllama() {
  try {
    const res = spawnSync("ollama", ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32"
    });
    return res.status === 0;
  } catch {
    return false;
  }
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

  // start frontend
  run("node", ["tests/static-server.js"]).catch(() => {});

  // start ollama ONLY if installed
  if (hasOllama()) {
    console.log("🤖 Starting Ollama...");
    run("ollama", ["serve"]).catch(() => {});
  } else {
    console.log("⚠️ Ollama not available - skipping AI tests");
  }

  // wait frontend
  await wait("http://localhost:3000");

  // wait ollama only if expected
  if (hasOllama()) {
    await wait("http://localhost:11434/api/tags");
  }

  // run tests
  await run("node", ["tests/ci-smoke.js"]);

  console.log("✅ CI PASSED");
}

main().catch(err => {
  console.error("❌ CI FAILED");
  console.error(err);
  process.exit(1);
});
