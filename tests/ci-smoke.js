const http = require("http");
const os = require("os");

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

    const req = http.request({
      hostname: "localhost",
      port: 11434,
      path: "/api/generate",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      }
    }, res => {
      let body = "";

      res.on("data", d => body += d);
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json.response || "");
        } catch {
          resolve("");
        }
      });
    });

    req.on("error", () => resolve(""));
    req.write(data);
    req.end();
  });
}

// -----------------------------
// SMART ERROR CLASSIFIER
// -----------------------------
function classifyError(stage, error) {
  const msg = (error?.message || "").toLowerCase();

  if (stage === "frontend") return "FRONTEND_FAILURE";
  if (stage === "ollama") return "OLLAMA_FAILURE";

  if (msg.includes("empty")) return "MODEL_EMPTY_RESPONSE";
  if (msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("econnrefused")) return "SERVICE_NOT_RUNNING";

  return "UNKNOWN_FAILURE";
}

// -----------------------------
async function safeAsk(prompt, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const res = await ask(prompt);

    if (res && res.trim()) return res;

    console.log(`⚠ retry ${i + 1}/${retries}`);
    await sleep(1500);
  }

  throw new Error("EMPTY_RESPONSE");
}

// -----------------------------
async function waitForOllama() {
  for (let i = 0; i < 60; i++) {
    const res = await ask("ping");
    if (typeof res === "string") return;
    await sleep(1000);
  }

  throw new Error("OLLAMA_TIMEOUT");
}

// -----------------------------
async function run() {
  const platform = os.platform();

  const report = {
    os: platform,
    frontend: "unknown",
    ai: "unknown",
    error: null
  };

  console.log("\n========================");
  console.log("🧪 CI INTELLIGENT SMOKE TEST");
  console.log("OS:", platform);
  console.log("========================\n");

  try {
    await waitForOllama();

    const r1 = await safeAsk("say OK in one word");
    const r2 = await safeAsk("2+2=? answer only");

    report.ai = "pass";

    if (!r1 || !r2) {
      throw new Error("MODEL_EMPTY_RESPONSE");
    }

    console.log("AI RESULTS:", { r1, r2 });

  } catch (e) {
    report.ai = "fail";
    report.error = classifyError("ai", e);
    throw e;
  }

  console.log("\n========================");
  console.log("📊 CI REPORT SUMMARY");
  console.log("========================");
  console.log(JSON.stringify(report, null, 2));
}

run().catch(err => {
  const type = classifyError("ai", err);

  console.log("\n❌ CI FAILED");
  console.log("TYPE:", type);
  console.log("MESSAGE:", err.message);

  process.exit(1);
});
