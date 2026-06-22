const http = require("http");
const os = require("os");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGetJson(port, path, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "localhost", port, path, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("INVALID_JSON"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
  });
}

function checkHttpUp(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "localhost", port, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
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
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
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
// Waits for the Ollama daemon itself to answer, by polling /api/tags.
//
// FIX: the previous version called ask("ping") and checked
// `typeof res === "string"`. ask() always resolves a string -- it returns
// "" on a connection error instead of rejecting -- so that check was
// trivially true on the very first attempt and never actually waited for
// anything.
async function waitForOllama(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await httpGetJson(11434, "/api/tags");
      return;
    } catch {
      await sleep(1000);
    }
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

  // FIX: `report.frontend` was declared but never actually set anywhere,
  // so the dashboard always showed "unknown" regardless of reality.
  const frontendUp = await checkHttpUp(3000);
  report.frontend = frontendUp ? "pass" : "fail";

  let aiError = null;
  try {
    await waitForOllama();
    const r1 = await safeAsk("say OK in one word");
    const r2 = await safeAsk("2+2=? answer only");
    if (!r1 || !r2) {
      throw new Error("MODEL_EMPTY_RESPONSE");
    }
    report.ai = "pass";
    console.log("AI RESULTS:", { r1, r2 });
  } catch (e) {
    report.ai = "fail";
    aiError = e;
    report.error = classifyError("ai", e);
  }

  if (!frontendUp && !report.error) {
    report.error = classifyError("frontend", new Error("FRONTEND_UNREACHABLE"));
  }

  // FIX: previously this summary was only printed on the success path,
  // because the catch block re-threw before reaching it. Print it
  // unconditionally so failed runs still show the full report.
  console.log("\n========================");
  console.log("📊 CI REPORT SUMMARY");
  console.log("========================");
  console.log(JSON.stringify(report, null, 2));

  if (aiError || !frontendUp) {
    console.log("\n❌ CI FAILED");
    console.log("TYPE:", report.error);
    console.log("MESSAGE:", aiError ? aiError.message : "Frontend not reachable on port 3000");
    process.exit(1);
  }
}

run().catch((err) => {
  // This only catches genuine bugs in the script itself (the expected
  // failure paths above already report and exit on their own).
  console.error("\n💥 UNEXPECTED SCRIPT ERROR");
  console.error(err);
  process.exit(1);
});
