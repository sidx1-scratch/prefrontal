#!/usr/bin/env node
'use strict';

/*
 * Agent relay smoke test: exercises the /api/agent/* endpoints added
 * to server.js — pairing, the agent's outbound SSE stream, the UI SSE
 * stream, command forwarding, event broadcasting, permission
 * responses, and revocation. Zero dependencies, mirrors proxy-smoke.js.
 */

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');

function request(port, method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = {};
    if (payload) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers,
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: responseBody,
      }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Open an SSE stream and accumulate parsed `data:` frames into `events`.
function openSSE(port, requestPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, res => {
      const events = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch {
              // Ignore malformed frames.
            }
          }
        }
      });
      resolve({ events, res });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

function eventList(events) {
  return events.map(e => e.type);
}

async function main() {
  const appPort = await new Promise((resolve, reject) => {
    const probe = require('net').createServer();
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
      // Keep the shared-secret flow isolated from any real ~/.prefrontal-agent
      PREFRONTAL_SHARED_SECRET: 'ci-shared-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });

  let agentStream;
  let uiStream;

  try {
    // Wait for the server.
    await waitFor(async () => {
      try {
        const r = await request(appPort, 'GET', '/api/config');
        return r.status === 200;
      } catch {
        return false;
      }
    }, 'server ready');

    // 1. Browser creates a pairing token.
    const pair = await request(appPort, 'POST', '/api/agent/pair', {});
    assert.strictEqual(pair.status, 200);
    const pairingToken = JSON.parse(pair.body).token;
    assert.ok(pairingToken && pairingToken.length >= 32, 'pairing token looks random');

    // 2. Status is 'waiting' before the agent confirms.
    const waiting = await request(appPort, 'GET', `/api/agent/pair/status?token=${pairingToken}`);
    assert.strictEqual(JSON.parse(waiting.body).status, 'waiting');

    // 3. Agent exchanges the token for a session.
    const confirm = await request(appPort, 'POST', '/api/agent/pair/confirm', {
      token: pairingToken,
      agentName: 'ci-agent',
    });
    assert.strictEqual(confirm.status, 200);
    const { sessionId, token: sessionToken } = JSON.parse(confirm.body);
    assert.ok(sessionId && sessionToken);

    // 4. Using the same token again fails (single-use).
    const reuse = await request(appPort, 'POST', '/api/agent/pair/confirm', {
      token: pairingToken,
      agentName: 'ci-agent',
    });
    assert.strictEqual(reuse.status, 401);

    // 5. Browser poll now reports 'paired' with the session token.
    const paired = await request(appPort, 'GET', `/api/agent/pair/status?token=${pairingToken}`);
    const pairedBody = JSON.parse(paired.body);
    assert.strictEqual(pairedBody.status, 'paired');
    assert.strictEqual(pairedBody.sessionId, sessionId);

    // 6. Agent connects its outbound stream.
    agentStream = await openSSE(appPort, `/api/agent/agent-stream?session=${sessionId}`, sessionToken);

    // 7. UI subscribes to its stream.
    uiStream = await openSSE(appPort, `/api/agent/stream?session=${sessionId}`, sessionToken);
    await waitFor(() => uiStream.events.some(e => e.type === 'hello'), 'UI hello event');
    const hello = uiStream.events.find(e => e.type === 'hello');
    assert.strictEqual(hello.agentName, 'ci-agent');

    // 8. UI sends a command; the agent stream receives it.
    const sent = await request(appPort, 'POST', '/api/agent/command', { command: 'run echo hi' }, sessionToken);
    assert.strictEqual(sent.status, 200);
    await waitFor(() => agentStream.events.some(e => e.type === 'command'), 'command forwarded to agent');
    const command = agentStream.events.find(e => e.type === 'command');
    assert.strictEqual(command.command, 'run echo hi');

    // 9. Agent streams events; the UI stream receives them.
    const events = await request(appPort, 'POST', '/api/agent/events', {
      session: sessionId,
      events: [
        { type: 'output', stream: 'stdout', text: 'hi from sandbox\n' },
        { type: 'command-end', command: 'run echo hi', exitCode: 0, durationMs: 42 },
        { type: 'status', status: 'connected', agentName: 'ci-agent', workspace: '/tmp/ci' },
      ],
    }, sessionToken);
    assert.strictEqual(events.status, 200);
    await waitFor(() => uiStream.events.some(e => e.type === 'output'), 'output broadcast to UI');
    assert.strictEqual(uiStream.events.find(e => e.type === 'output').text, 'hi from sandbox\n');
    assert.strictEqual(uiStream.events.find(e => e.type === 'command-end').exitCode, 0);
    assert.strictEqual(uiStream.events.find(e => e.type === 'status').workspace, '/tmp/ci');

    // 10. UI answers a permission request; the agent stream receives it.
    const perm = await request(appPort, 'POST', '/api/agent/permission-response', {
      requestId: 'req-1',
      granted: true,
    }, sessionToken);
    assert.strictEqual(perm.status, 200);
    await waitFor(() => agentStream.events.some(e => e.type === 'permission-response'), 'permission response to agent');
    const permEvent = agentStream.events.find(e => e.type === 'permission-response');
    assert.strictEqual(permEvent.requestId, 'req-1');
    assert.strictEqual(permEvent.granted, true);

    // 11. GET /api/agent/session reports the agent's state.
    const info = await request(appPort, 'GET', '/api/agent/session', undefined, sessionToken);
    assert.strictEqual(JSON.parse(info.body).agentName, 'ci-agent');
    assert.strictEqual(JSON.parse(info.body).workspace, '/tmp/ci');

    // 11a. Model selection: the browser reports it, the agent reads it.
    const noModel = await request(appPort, 'GET', '/api/agent/model-state', undefined, sessionToken);
    assert.strictEqual(noModel.status, 404);
    const setModel = await request(appPort, 'POST', '/api/agent/model-state', {
      runtime: 'openrouter',
      model: 'mistralai/mistral-7b-instruct:free',
      serverUrl: 'http://localhost:3000',
    }, sessionToken);
    assert.strictEqual(setModel.status, 200);
    const getModel = await request(appPort, 'GET', '/api/agent/model-state', undefined, sessionToken);
    assert.strictEqual(getModel.status, 200);
    assert.strictEqual(JSON.parse(getModel.body).runtime, 'openrouter');
    assert.strictEqual(JSON.parse(getModel.body).model, 'mistralai/mistral-7b-instruct:free');

    // 11b. The agent LLM proxy rejects non-OpenRouter runtimes.
    const llmReject = await request(appPort, 'POST', '/api/agent/llm', {
      runtime: 'ollama',
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    }, sessionToken);
    assert.strictEqual(llmReject.status, 403);
    assert.match(JSON.parse(llmReject.body).error, /OpenRouter only/i);

    // 11c. The agent LLM proxy requires a server-side OpenRouter key. When one
    // IS configured it makes a real upstream request (skipped here); when it is
    // not, it refuses cleanly instead of calling out.
    if (!process.env.OPENROUTER_API_KEY) {
      const llmNoKey = await request(appPort, 'POST', '/api/agent/llm', {
        runtime: 'openrouter',
        model: 'mistralai/mistral-7b-instruct:free',
        messages: [{ role: 'user', content: 'hi' }],
      }, sessionToken);
      assert.strictEqual(llmNoKey.status, 403);
    }

    // 11d-1. Ask-user: a browser answer is forwarded to the agent stream.
    const ask = await request(appPort, 'POST', '/api/agent/ask-response', {
      requestId: 'ask-1', answer: 'python',
    }, sessionToken);
    assert.strictEqual(ask.status, 200);
    await waitFor(() => agentStream.events.some(e => e.type === 'ask-response'), 'ask-response to agent');
    const askEvent = agentStream.events.find(e => e.type === 'ask-response');
    assert.strictEqual(askEvent.requestId, 'ask-1');
    assert.strictEqual(askEvent.answer, 'python');

    // 11d-2. Auto-pair: wrong secret rejected, correct secret (localhost) works.
    const autoWrong = await request(appPort, 'POST', '/api/agent/auto-pair', {
      secret: 'nope', agentName: 'ci-agent',
    });
    assert.strictEqual(autoWrong.status, 401);
    const autoGood = await request(appPort, 'POST', '/api/agent/auto-pair', {
      secret: 'ci-shared-secret', agentName: 'ci-agent',
    });
    assert.strictEqual(autoGood.status, 200);
    const autoSession = JSON.parse(autoGood.body);
    assert.ok(autoSession.sessionId && autoSession.token);
    // A fresh auto-paired token can authenticate.
    const autoInfo = await request(appPort, 'GET', '/api/agent/session', undefined, autoSession.token);
    assert.strictEqual(autoInfo.status, 200);

    // 12. Revocation: session gone, old token rejected.
    const revoke = await request(appPort, 'POST', '/api/agent/revoke', {}, sessionToken);
    assert.strictEqual(revoke.status, 200);
    const after = await request(appPort, 'GET', '/api/agent/session', undefined, sessionToken);
    assert.strictEqual(after.status, 401);

    console.log('Agent relay smoke test passed.');
  } catch (error) {
    if (stderr) console.error(stderr.trim());
    throw error;
  } finally {
    if (agentStream) agentStream.res.destroy();
    if (uiStream) uiStream.res.destroy();
    child.kill();
  }
}

main().catch(error => {
  console.error(`Agent relay smoke test failed: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
