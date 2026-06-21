const http = require("http");

function fail(stage, err) {
  console.error("\n❌ [" + stage + " FAILED]");
  console.error(err?.stack || err);
  process.exit(1);
}

function waitFor(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      http.get(url, () => resolve())
        .on("error", () => {
          if (Date.now() - start > timeout) {
            reject(new Error("Timeout waiting for " + url));
          } else {
            setTimeout(check, 1000);
          }
        });
    };

    check();
  });
}

function ollama(prompt) {
  return new Promise((resolve, reject) => {
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
        "Content-Length": data.length
      }
    }, res => {
      let body = "";

      res.on("data", d => body += d);

      res.on("end", () => {
        try {
          const json = JSON.parse(body);

          if (!json.response) {
            return reject(new Error("Empty response"));
          }

          resolve(json.response);
        } catch (e) {
          reject(new Error("Bad JSON: " + body));
        }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  try {
    console.log("🔍 Frontend check...");
    await waitFor("http://localhost:3000");
    console.log("✅ Frontend running");

  } catch (e) {
    return fail("FRONTEND", e);
  }

  let r1;
  try {
    console.log("\n🧠 Single-turn AI test...");
    r1 = await ollama("Say hello in one word");

    if (!r1 || r1.length < 1) {
      throw new Error("Empty response");
    }

    console.log("✅ AI OK:", r1);

  } catch (e) {
    return fail("OLLAMA SINGLE TURN", e);
  }

  try {
    console.log("\n🔁 Multi-turn test...");

    const r2 = await ollama("Remember: answer is YES. Now answer: is it yes?");
    const r3 = await ollama("Repeat your last answer in one word.");

    if (!r2 || !r3) {
      throw new Error("Multi-turn failure");
    }

    console.log("✅ Multi-turn OK");
    console.log("r2:", r2);
    console.log("r3:", r3);

  } catch (e) {
    return fail("OLLAMA MULTI TURN", e);
  }

  console.log("\n🎉 ALL TESTS PASSED");
})();
