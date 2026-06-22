#!/usr/bin/env node
/**
 * start-background.js
 *
 * Starts a long-running command (a dev server, `ollama serve`, etc.) as a
 * fully detached background process and returns immediately.
 *
 * Why this exists:
 * GitHub Actions runs each `run:` step as its own process. Backgrounding a
 * command with a bare shell `&` works on Linux/macOS most of the time, but
 * is unreliable on windows-latest because Git Bash processes are attached
 * to a Windows job object that can tear down child processes when the step
 * that spawned them exits. Node's `spawn(..., { detached: true })` +
 * `child.unref()` is the supported cross-platform way to fully detach a
 * child process from its parent, so it survives into later steps.
 *
 * Usage:
 *   node scripts/start-background.js --name <label> --log <file> --pidfile <file> -- <command> [args...]
 *
 * Example:
 *   node scripts/start-background.js --name ollama --log ollama.log --pidfile ollama.pid -- ollama serve
 */
const { spawn } = require("child_process");
const fs = require("fs");

function parseArgs(argv) {
  const opts = { name: "process", log: "process.log", pidfile: "process.pid" };
  const sepIndex = argv.indexOf("--");
  const flagArgs = sepIndex === -1 ? argv : argv.slice(0, sepIndex);
  const command = sepIndex === -1 ? [] : argv.slice(sepIndex + 1);

  for (let i = 0; i < flagArgs.length; i++) {
    if (flagArgs[i] === "--name") opts.name = flagArgs[++i];
    else if (flagArgs[i] === "--log") opts.log = flagArgs[++i];
    else if (flagArgs[i] === "--pidfile") opts.pidfile = flagArgs[++i];
  }
  return { opts, command };
}

const { opts, command } = parseArgs(process.argv.slice(2));

if (command.length === 0) {
  console.error(`[${opts.name}] No command given. Usage: start-background.js --name X --log Y --pidfile Z -- <cmd> [args]`);
  process.exit(1);
}

// Open the log file ourselves and hand the raw fd to the child so the
// child writes directly to disk. This matters: if we used 'pipe' instead,
// the parent process would need to stay alive to drain it, which defeats
// the whole point of detaching.
const logFd = fs.openSync(opts.log, "a");

const child = spawn(command[0], command.slice(1), {
  detached: true,
  stdio: ["ignore", logFd, logFd],
  windowsHide: true
});

if (!child.pid) {
  console.error(`[${opts.name}] Failed to start "${command.join(" ")}"`);
  process.exit(1);
}

fs.writeFileSync(opts.pidfile, String(child.pid));
console.log(`[${opts.name}] started (pid ${child.pid}), logging to ${opts.log}`);

child.on("error", (err) => {
  console.error(`[${opts.name}] spawn error: ${err.message}`);
});

// Let this launcher process exit without waiting for, or killing, the child.
child.unref();
