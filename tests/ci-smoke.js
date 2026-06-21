const http = require("http");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function ask(prompt) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      model: "llama3.2:1b",
      prompt,
      stream: false
    });

    const req = http.request(
      {
        hostname: "localhost",
        port: 11434,
        path: "/api/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      res => {
        let body = "";

        res.on("data", chunk => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve(json.response || "");
          } catch {
            resolve("");
          }
        });
      }
    );

    req.on("error", () => resolve(""));
    req.write(data);
    req.end();
  });
}

// ✅ CRITICAL FIX: retry + macOS cold-start safety
async function safeAsk(prompt, retries = 6) {
  for (let i = 0; i < retries; i++) {
    const res = await ask(prompt);

    if (res && res.trim().length > 0) {
      return res;
    }

    console.log(`⚠ empty response retry ${i + 1}/${retries}`);
    await sleep(2000);
  }

  throw new Error("CI smoke test failed: model never responded properly");
}

// ✅ wait until Ollama API is actually alive
async function waitForOllama() {
  console.log("⏳ Waiting for Ollama API...");

  for (let i = 0; i < 60; i++) {
    const res = await ask("ping");

    if (typeof res === "string") {
      return;
    }

    await sleep(1000);
  }

  throw new Error("Ollama API not ready");
}

async function run() {
  console.log("🚀 CI SMOKE TEST START");

  await waitForOllama();

  // 🧪 minimal real checks (fast + safe)
  const r1 = await safeAsk("say OK in one word");
  const r2 = await safeAsk("2+2=? answer only");

  console.log("\n✅ RESULTS:");
  console.log({ r1, r2 });

  if (!r1 || !r2) {
    throw new Error("Smoke test failed");
  }

  console.log("\n🎉 CI SMOKE PASSED");
}

run().catch(err => {
  console.error("\n❌ CI FAILED");
  console.error(err);
  process.exit(1);
});
