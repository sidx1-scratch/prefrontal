'use strict';

/* ═══════════════════════════════════════════════════════════════
   Prefrontal — Proxy Server (server.js)
   Copyright (C) 2026 sidx1-scratch

   Serves the static frontend and proxies AI API calls so that
   API keys stay server-side (in .env) and never touch the browser.
   ═══════════════════════════════════════════════════════════════ */

require('dotenv').config();
const express = require('express');
const http    = require('http');
const https   = require('https');
const path    = require('path');
const url     = require('url');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── /api/config — exposes which keys are set (never the values) ──
app.get('/api/config', (req, res) => {
  res.json({
    openrouterKey: process.env.OPENROUTER_API_KEY || '',
    openaiKey:     process.env.OPENAI_API_KEY     || '',
    groqKey:       process.env.GROQ_API_KEY       || '',
    togetherKey:   process.env.TOGETHER_API_KEY   || '',
    anthropicKey:  process.env.ANTHROPIC_API_KEY  || '',
    hasServerKeys: !!(
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY     ||
      process.env.GROQ_API_KEY       ||
      process.env.TOGETHER_API_KEY   ||
      process.env.ANTHROPIC_API_KEY
    ),
  });
});

// ── /api/proxy — forward requests to AI backends ─────────────────
// This avoids CORS issues and keeps API keys server-side.
app.post('/api/proxy', (req, res) => {
  const { targetUrl, method = 'POST', headers = {}, body } = req.body;
  if (!targetUrl) { res.status(400).json({ error: 'Missing targetUrl' }); return; }

  let parsed;
  try { parsed = new url.URL(targetUrl); } catch {
    res.status(400).json({ error: 'Invalid targetUrl' }); return;
  }

  const isHttps   = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const bodyStr   = body ? JSON.stringify(body) : undefined;

  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers,
    ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
  };

  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method,
    headers:  reqHeaders,
  };

  const proxyReq = transport.request(options, proxyRes => {
    res.status(proxyRes.statusCode);
    // Forward relevant headers
    const ct = proxyRes.headers['content-type'] || '';
    res.setHeader('Content-Type', ct);
    if (ct.includes('text/event-stream')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
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
  console.log(`  API keys loaded from .env file`);
  const keys = [
    ['OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY],
    ['OPENAI_API_KEY',     process.env.OPENAI_API_KEY],
    ['GROQ_API_KEY',       process.env.GROQ_API_KEY],
    ['TOGETHER_API_KEY',   process.env.TOGETHER_API_KEY],
    ['ANTHROPIC_API_KEY',  process.env.ANTHROPIC_API_KEY],
  ];
  for (const [name, val] of keys) {
    if (val) console.log(`  ✓ ${name} configured`);
  }
  console.log();
});
