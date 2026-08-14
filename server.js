'use strict';

/* ═══════════════════════════════════════════════════════════════
   Prefrontal — Proxy Server (server.js)
   Copyright (C) 2026 sidx1-scratch

   Serves the static frontend and proxies approved AI API calls so
   provider API keys remain server-side in .env.
   ═══════════════════════════════════════════════════════════════ */

require('dotenv').config();
const express = require('express');
const http    = require('http');
const https   = require('https');
const path    = require('path');

const app  = express();
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

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

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

// ── /api/config — exposes key availability, never key values ─────
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(configPayload());
});

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

// ── /api/proxy — forward approved AI requests with server-side keys ─
app.post('/api/proxy', (req, res) => {
  if (!consumeRateLimit(req)) {
    res.status(429).json({ error: 'Proxy rate limit exceeded. Try again later.' });
    return;
  }

  const { targetUrl, runtime, method = 'POST', body } = req.body || {};
  if (!targetUrl || !runtime) {
    res.status(400).json({ error: 'Missing targetUrl or runtime' });
    return;
  }

  const provider = PROVIDERS[runtime];
  const apiKey = provider && process.env[provider.env];
  if (!provider || !apiKey) {
    res.status(403).json({ error: 'No server-side key is configured for this runtime' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).json({ error: 'Invalid targetUrl' });
    return;
  }

  const normalizedMethod = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(normalizedMethod)) {
    res.status(400).json({ error: 'Only GET and POST proxy methods are supported' });
    return;
  }
  if (!isAllowedTarget(parsed, runtime)) {
    res.status(403).json({ error: 'Proxy target is not allowed for this runtime' });
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
    res.status(proxyRes.statusCode || 502);
    const contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (contentType.includes('text/event-stream')) {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(120000, () => proxyReq.destroy(new Error('Upstream request timed out')));
  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: `Upstream request failed: ${err.message}` });
  });

  if (bodyStr) proxyReq.write(bodyStr);
  proxyReq.end();
});

// ── SPA fallback ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🧠 Prefrontal is running at http://localhost:${PORT}`);
  console.log('  Server-side API keys configured:');
  for (const [runtime, provider] of Object.entries(PROVIDERS)) {
    if (hasKey(provider.env)) console.log(`  ✓ ${runtime}`);
  }
  console.log();
});
