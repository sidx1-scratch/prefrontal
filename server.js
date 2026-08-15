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
