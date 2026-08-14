#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function request(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : undefined,
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: responseBody,
      }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function waitForServer(port, child) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const response = await request(port, 'GET', '/api/config');
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${lastError?.message || 'timeout'}`);
}

async function main() {
  const upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      authorization: req.headers.authorization || null,
      method: req.method,
      path: req.url,
    }));
  });
  const upstreamPort = await listen(upstream);
  const appPort = await new Promise((resolve, reject) => {
    const probe = netServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.once('error', reject);
  });

  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENAI_API_KEY: 'ci-proxy-secret',
      PROXY_ALLOWED_HOSTS: '127.0.0.1',
      PROXY_ALLOW_HTTP: 'true',
      PROXY_RATE_LIMIT: '5',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForServer(appPort, child);

    const configResponse = await request(appPort, 'GET', '/api/config');
    assert.strictEqual(configResponse.status, 200);
    assert.strictEqual(JSON.parse(configResponse.body).openaiKey, true);
    assert.ok(!configResponse.body.includes('ci-proxy-secret'), 'config endpoint leaked the provider secret');

    const approved = await request(appPort, 'POST', '/api/proxy', {
      targetUrl: `http://127.0.0.1:${upstreamPort}/v1/models`,
      runtime: 'openai_direct',
      method: 'GET',
      headers: { Authorization: 'Bearer attacker-token' },
    });
    assert.strictEqual(approved.status, 200);
    const upstreamRequest = JSON.parse(approved.body);
    assert.strictEqual(upstreamRequest.authorization, 'Bearer ci-proxy-secret');
    assert.strictEqual(upstreamRequest.method, 'GET');
    assert.strictEqual(upstreamRequest.path, '/v1/models');

    const rejected = await request(appPort, 'POST', '/api/proxy', {
      targetUrl: 'https://example.com/v1/models',
      runtime: 'openai_direct',
      method: 'GET',
    });
    assert.strictEqual(rejected.status, 403);

    // The first two proxy requests consumed two of the five allowed slots.
    for (let i = 0; i < 3; i++) {
      const response = await request(appPort, 'POST', '/api/proxy', {
        targetUrl: 'https://example.com/v1/models',
        runtime: 'openai_direct',
        method: 'GET',
      });
      assert.strictEqual(response.status, 403);
    }
    const rateLimited = await request(appPort, 'POST', '/api/proxy', {
      targetUrl: 'https://example.com/v1/models',
      runtime: 'openai_direct',
      method: 'GET',
    });
    assert.strictEqual(rateLimited.status, 429);

    console.log('Proxy smoke test passed.');
  } catch (error) {
    if (stderr) console.error(stderr.trim());
    throw error;
  } finally {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
}

// A tiny helper keeps the test independent of any test framework.
function netServer() {
  return require('net').createServer();
}

main().catch(error => {
  console.error(`Proxy smoke test failed: ${error.message}`);
  process.exit(1);
});
