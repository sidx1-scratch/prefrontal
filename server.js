#!/usr/bin/env node
'use strict';

/* ═══════════════════════════════════════════════════════════════
   Prefrontal — Proxy Server (server.js)
   Copyright (C) 2026 sidx1-scratch

   Serves the static frontend and proxies approved AI API calls so
   provider API keys remain server-side in .env.

   Dependency-free build: uses only Node's built-in modules
   (http, https, fs, path, url) — no express, no dotenv, no
   node_modules required.
   ═══════════════════════════════════════════════════════════════ */

const fs    = require('fs');
const http  = require('http');
const https = require('https');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;

// ── Minimal .env loader (replaces the `dotenv` package) ──────────
// Mirrors dotenv's default behavior: parses KEY=VALUE lines, strips
// surrounding quotes, ignores comments/blank lines, and never
// overwrites a variable that's already set in the real environment.
function loadEnv(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return; // no .env file — that's fine, same as dotenv's silent no-op
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv(path.join(ROOT, '.env'));

const PORT = process.env.PORT || 3000;

// ── Shared-secret auto-connect (localhost) ──────────────────────
// Both Prefrontal (this server) and the Prefrontal Agent read the same
// random secret from a file so the agent can auto-connect in the background,
// replacing the manual copy/paste flow. The file lives in the
// agent's shared data dir (same machine, localhost). Override with
// PREFRONTAL_SHARED_SECRET to pin it, or PREFRONTAL_SHARED_SECRET_FILE to
// relocate it. Auto-pair only works for loopback clients by default.
const SHARED_SECRET_FILE = process.env.PREFRONTAL_SHARED_SECRET_FILE ||
  path.join(os.tmpdir(), 'prefrontal-agent', 'shared-secret');

function loadOrCreateSharedSecret() {
  const pinned = process.env.PREFRONTAL_SHARED_SECRET;
  if (pinned) return pinned;
  try {
    const existing = fs.readFileSync(SHARED_SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch (e) {
    // Missing — generate below.
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SHARED_SECRET_FILE), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(SHARED_SECRET_FILE), 0o700); } catch {}
    fs.writeFileSync(SHARED_SECRET_FILE, secret + '\n', { mode: 0o600 });
  } catch (e) {
    // Best-effort: some installs can't write it; auto-pair just won't work.
  }
  return secret;
}
const SHARED_SECRET = loadOrCreateSharedSecret();

function isLoopback(remoteAddress) {
  return /^(::1|127\.|::ffff:127\.)/.test(String(remoteAddress || ''));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Agent: auto-connect using the shared localhost secret.
async function handleAgentAutoPair(req, res) {
  if (!isLoopback(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: 'Auto-connect is only available from localhost.' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const { secret, agentName } = body || {};
  if (!secret || !safeEqual(secret, SHARED_SECRET)) {
    sendJson(res, 401, { error: 'Invalid or missing shared secret' });
    return;
  }
  // Create a session for the local agent. The browser discovers this session
  // through /api/agent/discover; no token needs to be copied by the user.
  const sessionId = genToken();
  const session = {
    sessionId,
    token: genToken(),
    agentName: String(agentName || 'prefrontal-agent').slice(0, 64),
    agentInfo: null,
    connected: false,
    agentRes: null,
    uiStreams: new Set(),
    queue: [],
    modelState: null,
    createdAt: Date.now(),
    autoConnected: true,
  };
  agentSessions.set(sessionId, session);
  sendJson(res, 200, { sessionId, token: session.token });
}

const PROVIDERS = {
  openrouter: {
    env: 'OPENROUTER_API_KEY',
    origin: 'https://openrouter.ai',
    pathPrefix: '/api/v1',
  },
  openai_direct: {
    env: 'OPENAI_API_KEY',
    origin: 'https://api.openai.com',
    pathPrefix: '/v1',
  },
  groq: {
    env: 'GROQ_API_KEY',
    origin: 'https://api.groq.com',
    pathPrefix: '/openai/v1',
  },
  together: {
    env: 'TOGETHER_API_KEY',
    origin: 'https://api.together.xyz',
    pathPrefix: '/v1',
  },
};

const EXTRA_PROXY_HOSTS = new Set(
  (process.env.PROXY_ALLOWED_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);
const configuredRateLimit = Number(process.env.PROXY_RATE_LIMIT || 60);
const PROXY_RATE_LIMIT = Number.isFinite(configuredRateLimit) && configuredRateLimit > 0
  ? Math.floor(configuredRateLimit)
  : 60;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map();

function hasKey(envName) {
  return Boolean(process.env[envName]);
}

function configPayload() {
  return {
    // Availability flags only. Never return the actual secret values.
    openrouterKey: hasKey('OPENROUTER_API_KEY'),
    openaiKey:     hasKey('OPENAI_API_KEY'),
    groqKey:       hasKey('GROQ_API_KEY'),
    togetherKey:   hasKey('TOGETHER_API_KEY'),
    anthropicKey:  hasKey('ANTHROPIC_API_KEY'),
    hasServerKeys: [
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
      'GROQ_API_KEY',
      'TOGETHER_API_KEY',
      'ANTHROPIC_API_KEY',
    ].some(hasKey),
  };
}

function clientAddress(req) {
  // Do not trust forwarded headers unless this server is behind a configured,
  // trusted reverse proxy. The socket address cannot be supplied by a caller.
  return req.socket.remoteAddress || 'unknown';
}

function consumeRateLimit(req) {
  const now = Date.now();
  const key = clientAddress(req);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= PROXY_RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function isAllowedTarget(target, runtime) {
  const provider = PROVIDERS[runtime];
  if (!provider) return false;
  if (target.protocol !== 'https:') {
    // Custom HTTP targets are opt-in and still require an explicit host.
    return EXTRA_PROXY_HOSTS.has(target.hostname.toLowerCase()) && process.env.PROXY_ALLOW_HTTP === 'true';
  }
  if (target.origin === provider.origin && target.pathname.startsWith(`${provider.pathPrefix}/`)) return true;
  return EXTRA_PROXY_HOSTS.has(target.hostname.toLowerCase());
}

function safeForwardHeaders(headers, apiKey) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (['authorization', 'host', 'content-length', 'connection'].includes(lower)) continue;
    forwarded[name] = value;
  }
  forwarded['Content-Type'] = 'application/json';
  if (apiKey) forwarded.Authorization = `Bearer ${apiKey}`;
  return forwarded;
}

// ── Tiny JSON body reader (replaces express.json()) ───────────────
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50mb, matches the original limit

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve(undefined); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

// ── /api/proxy handler — forward approved AI requests with server-side keys ─
async function handleProxy(req, res) {
  if (!consumeRateLimit(req)) {
    sendJson(res, 429, { error: 'Proxy rate limit exceeded. Try again later.' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }

  const { targetUrl, runtime, method = 'POST', body } = payload || {};
  if (!targetUrl || !runtime) {
    sendJson(res, 400, { error: 'Missing targetUrl or runtime' });
    return;
  }

  const provider = PROVIDERS[runtime];
  const apiKey = provider && process.env[provider.env];
  if (!provider || !apiKey) {
    sendJson(res, 403, { error: 'No server-side key is configured for this runtime' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    sendJson(res, 400, { error: 'Invalid targetUrl' });
    return;
  }

  const normalizedMethod = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(normalizedMethod)) {
    sendJson(res, 400, { error: 'Only GET and POST proxy methods are supported' });
    return;
  }
  if (!isAllowedTarget(parsed, runtime)) {
    sendJson(res, 403, { error: 'Proxy target is not allowed for this runtime' });
    return;
  }

  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);
  const reqHeaders = safeForwardHeaders({}, apiKey);
  if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);

  const proxyReq = transport.request({
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: normalizedMethod,
    headers: reqHeaders,
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 502, buildProxyResponseHeaders(proxyRes));
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(120000, () => proxyReq.destroy(new Error('Upstream request timed out')));
  proxyReq.on('error', err => {
    if (!res.headersSent) sendJson(res, 502, { error: `Upstream request failed: ${err.message}` });
  });

  if (bodyStr) proxyReq.write(bodyStr);
  proxyReq.end();
}

function buildProxyResponseHeaders(proxyRes) {
  const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
  const headers = { 'Content-Type': contentType };
  if (contentType.includes('text/event-stream')) {
    headers['Cache-Control'] = 'no-cache, no-transform';
    headers['X-Accel-Buffering'] = 'no';
  }
  return headers;
}

// ── Prefrontal Agent relay (dependency-free) ──────────────────────
// Bridges the local Prefrontal Agent and the browser UI over plain
// HTTP + Server-Sent Events. The agent maintains an OUTBOUND
// authenticated stream to this server (no inbound ports anywhere),
// and the UI subscribes to a stream keyed to the same session.
// Session state lives in memory: restarting the server clears it and
// the agent re-pairs.

const AGENT_HEARTBEAT_MS = 15 * 1000;
const MAX_QUEUED_COMMANDS = 20;
const agentSessions = new Map();     // sessionId -> session

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

// Find a session by its long-lived session token.
function sessionFromRequest(req) {
  const token = readBearer(req);
  if (!token) return null;
  for (const session of agentSessions.values()) {
    if (session.token === token) return session;
  }
  return null;
}

function requireAgentSession(req, res) {
  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }
  return session;
}

function sendSSE(res, payload) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
}

function broadcastToUI(session, payload) {
  for (const res of session.uiStreams) sendSSE(res, payload);
}

function closeSession(sessionId) {
  const session = agentSessions.get(sessionId);
  if (!session) return false;
  if (session.agentRes) { try { session.agentRes.end(); } catch {} }
  for (const res of session.uiStreams) { try { res.end(); } catch {} }
  agentSessions.delete(sessionId);
  return true;
}

// Browser: discover the local agent session created by auto-connect.
function handleAgentDiscover(req, res) {
  if (!isLoopback(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: 'Auto-connect discovery is only available from localhost' });
    return;
  }
  const session = [...agentSessions.values()].find(candidate => candidate.autoConnected);
  if (!session) {
    sendJson(res, 404, { error: 'No auto-connected agent found' });
    return;
  }
  sendJson(res, 200, {
    sessionId: session.sessionId,
    token: session.token,
    agentName: session.agentName,
  }, { 'Cache-Control': 'no-store' });
}

// Agent's outbound SSE stream. Holds the connection, flushes queued
// commands, and reports connection state changes to the UI streams.
function handleAgentStream(req, res, session) {
  openSSE(res);
  session.agentRes = res;
  session.connected = true;
  broadcastToUI(session, { type: 'status', status: 'connected', ...(session.agentInfo || {}) });
  for (const command of session.queue.splice(0)) sendSSE(res, { type: 'command', command });
  const heartbeat = setInterval(() => sendSSE(res, { type: 'ping' }), AGENT_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    if (session.agentRes === res) {
      session.agentRes = null;
      session.connected = false;
      broadcastToUI(session, { type: 'status', status: 'disconnected' });
    }
  });
}

// Browser's SSE stream for a session.
function handleUIStream(req, res, session) {
  openSSE(res);
  session.uiStreams.add(res);
  sendSSE(res, {
    type: 'hello',
    sessionId: session.sessionId,
    agentName: session.agentName,
    connected: session.connected,
    workspace: (session.agentInfo && session.agentInfo.workspace) || null,
  });
  const heartbeat = setInterval(() => sendSSE(res, { type: 'ping' }), AGENT_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    session.uiStreams.delete(res);
  });
}

// Browser: send a tool command to the agent (queued while offline).
async function handleAgentCommand(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const command = body && body.command;
  if (typeof command !== 'string' || !command.trim()) {
    sendJson(res, 400, { error: 'Missing command' });
    return;
  }
  const trimmed = command.slice(0, 10000);
  if (session.connected && session.agentRes) {
    sendSSE(session.agentRes, { type: 'command', command: trimmed });
  } else {
    if (session.queue.length >= MAX_QUEUED_COMMANDS) {
      sendJson(res, 429, { error: 'Agent is offline and the command queue is full' });
      return;
    }
    session.queue.push(trimmed);
  }
  sendJson(res, 200, { queued: !session.connected });
}

// Agent: report events, broadcast to every connected UI stream.
async function handleAgentEvents(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const events = Array.isArray(body && body.events) ? body.events : [];
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue;
    if (event.type === 'status') session.agentInfo = event;
    broadcastToUI(session, event);
  }
  sendJson(res, 200, { ok: true, broadcast: events.length });
}

// Browser: answer an agent permission prompt.
async function handlePermissionResponse(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const { requestId, granted } = body || {};
  if (!requestId) {
    sendJson(res, 400, { error: 'Missing requestId' });
    return;
  }
  if (!session.connected || !session.agentRes) {
    sendJson(res, 409, { error: 'Agent is offline' });
    return;
  }
  sendSSE(session.agentRes, { type: 'permission-response', requestId, granted: Boolean(granted) });
  sendJson(res, 200, { ok: true });
}

// Browser: answer an agent ask-user prompt (selectable options from the
// planner's `ask_user` tool). Pushed to the agent stream, which resumes the
// paused task with the chosen answer.
async function handleAskResponse(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const { requestId, answer } = body || {};
  if (!requestId) {
    sendJson(res, 400, { error: 'Missing requestId' });
    return;
  }
  if (!session.connected || !session.agentRes) {
    sendJson(res, 409, { error: 'Agent is offline' });
    return;
  }
  sendSSE(session.agentRes, { type: 'ask-response', requestId, answer: answer == null ? null : String(answer) });
  sendJson(res, 200, { ok: true });
}

function handleAgentRevoke(req, res, session) {
  closeSession(session.sessionId);
  sendJson(res, 200, { ok: true });
}

function handleAgentSessionInfo(req, res, session) {
  sendJson(res, 200, {
    sessionId: session.sessionId,
    agentName: session.agentName,
    connected: session.connected,
    workspace: (session.agentInfo && session.agentInfo.workspace) || null,
    modelState: session.modelState,
    pairedAt: session.createdAt,
  }, { 'Cache-Control': 'no-store' });
}

// Browser: report the model selection currently active in the web UI for
// this session. The agent reads it (GET below) so its `task` planner uses
// exactly the model picked in the UI.
async function handleAgentModelStateSet(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const runtime = body && body.runtime ? String(body.runtime).slice(0, 32) : null;
  const model = body && body.model ? String(body.model).slice(0, 256) : null;
  if (!runtime || !model) {
    sendJson(res, 400, { error: 'runtime and model are required' });
    return;
  }
  session.modelState = {
    runtime,
    model,
    serverUrl: body.serverUrl ? String(body.serverUrl).slice(0, 512) : null,
  };
  broadcastToUI(session, { type: 'model-state', runtime, model });
  sendJson(res, 200, { ok: true, runtime, model });
}

// Agent: read the model selection currently active in the web UI.
function handleAgentModelStateGet(req, res, session) {
  if (!session.modelState) {
    sendJson(res, 404, { error: 'No model is selected in the Prefrontal UI yet' });
    return;
  }
  sendJson(res, 200, session.modelState);
}

// Agent: run a chat-completion through the server so the API key stays in
// .env and is never sent to the agent. Currently OpenRouter only — Ollama
// support is planned later.
async function handleAgentLlm(req, res, session) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.statusCode || 400, { error: err.message });
    return;
  }
  const { runtime, model, messages, temperature } = body || {};
  if (runtime !== 'openrouter') {
    sendJson(res, 403, {
      error: `Prefrontal agent integration currently supports OpenRouter only (got runtime "${runtime || 'none'}"). Ollama support is coming later.`,
    });
    return;
  }
  if (!hasKey('OPENROUTER_API_KEY')) {
    sendJson(res, 403, { error: 'No OPENROUTER_API_KEY is configured in the server .env' });
    return;
  }
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    sendJson(res, 400, { error: 'model and messages are required' });
    return;
  }

  const provider = PROVIDERS.openrouter;
  const upstream = {
    hostname: provider.origin.replace(/^https?:\/\//, ''),
    protocol: 'https:',
    port: 443,
  };
  const pathPrefix = provider.pathPrefix || '/api/v1';
  const bodyStr = JSON.stringify({
    model,
    messages,
    temperature: temperature == null ? 0.3 : temperature,
  });

  const proxyReq = https.request({
    hostname: upstream.hostname,
    port: upstream.port,
    path: `${pathPrefix}/chat/completions`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  }, proxyRes => {
    let chunks = '';
    proxyRes.setEncoding('utf8');
    proxyRes.on('data', c => { chunks += c; });
    proxyRes.on('end', () => {
      let content = '';
      try {
        const data = JSON.parse(chunks);
        content = data.choices && data.choices[0] && data.choices[0].message
          ? String(data.choices[0].message.content || '')
          : '';
        if (!content && data.error) content = `OpenRouter error: ${JSON.stringify(data.error)}`;
      } catch (e) {
        content = `OpenRouter returned non-JSON: ${chunks.slice(0, 500)}`;
      }
      if (proxyRes.statusCode >= 400) {
        sendJson(res, proxyRes.statusCode, { error: content || `OpenRouter returned ${proxyRes.statusCode}` });
      } else {
        sendJson(res, 200, { content, model, runtime });
      }
    });
  });
  proxyReq.setTimeout(120000, () => proxyReq.destroy(new Error('Upstream request timed out')));
  proxyReq.on('error', err => {
    if (!res.headersSent) sendJson(res, 502, { error: `Upstream request failed: ${err.message}` });
  });
  proxyReq.write(bodyStr);
  proxyReq.end();
}

// ── Static file serving (replaces express.static()) ───────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
};

// Resolves a request path safely inside ROOT (blocks path traversal via ..).
function resolveStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safeRelative = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(ROOT, safeRelative);
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

function tryServeStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.url.startsWith('/api/')) return false;

  const fullPath = resolveStaticPath(req.url);
  if (!fullPath) return false;

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return false; // let the SPA fallback handle it

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(fullPath).pipe(res);
  return true;
}

function serveIndex(res) {
  const indexPath = path.join(ROOT, 'index.html');
  fs.readFile(indexPath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('index.html not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

// ── Request router ─────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];

  try {
    // Static assets (app.js, style.css, vendor/*, manifest.json, ...) first,
    // matching express's middleware order.
    if (tryServeStatic(req, res)) return;

    if (pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, configPayload(), { 'Cache-Control': 'no-store' });
      return;
    }

    if (pathname === '/api/proxy' && req.method === 'POST') {
      await handleProxy(req, res);
      return;
    }

    // ── Prefrontal Agent relay ──
    if (pathname === '/api/agent/auto-pair' && req.method === 'POST') {
      await handleAgentAutoPair(req, res);
      return;
    }
    if (pathname === '/api/agent/discover' && req.method === 'GET') {
      handleAgentDiscover(req, res);
      return;
    }
    if (pathname === '/api/agent/stream' && req.method === 'GET') {
      const session = requireAgentSession(req, res);
      if (session) handleUIStream(req, res, session);
      return;
    }
    if (pathname === '/api/agent/agent-stream' && req.method === 'GET') {
      const session = requireAgentSession(req, res);
      if (session) handleAgentStream(req, res, session);
      return;
    }
    if (pathname === '/api/agent/command' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handleAgentCommand(req, res, session);
      return;
    }
    if (pathname === '/api/agent/events' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handleAgentEvents(req, res, session);
      return;
    }
    if (pathname === '/api/agent/permission-response' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handlePermissionResponse(req, res, session);
      return;
    }
    if (pathname === '/api/agent/ask-response' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handleAskResponse(req, res, session);
      return;
    }
    if (pathname === '/api/agent/revoke' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) handleAgentRevoke(req, res, session);
      return;
    }
    if (pathname === '/api/agent/session' && req.method === 'GET') {
      const session = requireAgentSession(req, res);
      if (session) handleAgentSessionInfo(req, res, session);
      return;
    }
    if (pathname === '/api/agent/model-state' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handleAgentModelStateSet(req, res, session);
      return;
    }
    if (pathname === '/api/agent/model-state' && req.method === 'GET') {
      const session = requireAgentSession(req, res);
      if (session) handleAgentModelStateGet(req, res, session);
      return;
    }
    if (pathname === '/api/agent/llm' && req.method === 'POST') {
      const session = requireAgentSession(req, res);
      if (session) await handleAgentLlm(req, res, session);
      return;
    }

    // SPA fallback — any other GET/HEAD serves index.html
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveIndex(res);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: `Internal server error: ${err.message}` });
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n  🧠 Prefrontal is running at http://localhost:${PORT}`);
  console.log('  Server-side API keys configured:');
  for (const [runtime, provider] of Object.entries(PROVIDERS)) {
    if (hasKey(provider.env)) console.log(`  ✓ ${runtime}`);
  }
  console.log();
});
