/* ═══════════════════════════════════════════════════════════════
   Prefrontal — Agent panel (agent.js)
   Copyright (C) 2026 sidx1-scratch

   Vanilla JS, zero dependencies — matching the project's no-build,
   no-framework rule. Renders a panel for pairing with a local
   Prefrontal Agent, sending it tool commands, streaming its output
   live, and answering permission prompts.

   Transport: plain HTTP + Server-Sent Events through the backend
   relay (server.js). The agent dials out; this page never needs to
   reach the agent directly.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

(function () {
  const LS_KEY = 'prefrontal.agent.session';

  const els = {};

  const state = {
    session: null,       // { sessionId, token, agentName }
    pairingToken: null,
    pairingPoll: null,
    streamAbort: null,   // AbortController for the UI SSE stream
    streamOpen: false,
    permRequest: null,   // { requestId, scope, detail }
  };

  // Chat delegation: app.js can subscribe to the agent's streamed events so
  // it can render `/agent …` commands as an assistant reply. Subscribers are
  // called with every event the UI SSE stream delivers.
  const listeners = new Set();
  function notifyListeners(event) {
    for (const fn of listeners) {
      try { fn(event); } catch (e) { /* ignore subscriber errors */ }
    }
  }

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    ['agentBtn', 'agentOverlay', 'agentClose', 'agentStatusPill', 'agentNameEl', 'agentWorkspaceEl',
      'pairingBox', 'pairBtn', 'pairActive', 'pairTokenValue', 'copyTokenBtn', 'pairCancelBtn',
      'commandBox', 'agentCommand', 'agentSendBtn', 'agentStopBtn', 'agentLog',
      'permBanner', 'permText', 'permAllowBtn', 'permDenyBtn', 'agentDisconnectBtn',
    ].forEach(id => { els[id] = $(id); });
  }

  // ── Log rendering ───────────────────────────────────────────────

  function logLine(kind, text) {
    const log = els.agentLog;
    const div = document.createElement('div');
    div.className = 'log-' + kind;
    div.textContent = text;
    log.appendChild(div);
    // Keep the log bounded.
    while (log.childElementCount > 2000) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function clearLog() {
    els.agentLog.textContent = '';
  }

  // ── Session persistence ─────────────────────────────────────────

  function loadSession() {
    try {
      state.session = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    } catch {
      state.session = null;
    }
  }

  function saveSession() {
    if (state.session) localStorage.setItem(LS_KEY, JSON.stringify(state.session));
    else localStorage.removeItem(LS_KEY);
  }

  function clearSession() {
    state.session = null;
    saveSession();
  }

  // Report the UI's current model selection to the server for this session
  // (the model lives in app.js -> window.getPrefrontalModelState). The agent
  // reads it so its `task` planner uses the same model as the chat UI.
  async function reportModelState() {
    if (!state.session) return;
    const ms = typeof window.getPrefrontalModelState === 'function' ? window.getPrefrontalModelState() : null;
    if (!ms || !ms.runtime || !ms.model) return;
    try {
      await api('/api/agent/model-state', { method: 'POST', body: JSON.stringify(ms) });
    } catch (err) {
      // Not critical — the agent just keeps its own model.
    }
  }

  // ── UI state ────────────────────────────────────────────────────

  function setStatus(connected, text) {
    els.agentStatusPill.classList.toggle('online', connected);
    els.agentStatusPill.classList.toggle('offline', !connected);
    els.agentStatusPill.textContent = text;
  }

  function showPairedUI() {
    els.pairingBox.style.display = 'none';
    els.commandBox.style.display = '';
    els.agentDisconnectBtn.style.display = '';
    els.agentNameEl.textContent = (state.session && state.session.agentName) || '—';
  }

  function showPairingUI() {
    els.pairingBox.style.display = '';
    els.commandBox.style.display = 'none';
    els.agentDisconnectBtn.style.display = 'none';
  }

  function applyHello(payload) {
    if (payload.agentName) {
      if (state.session) state.session.agentName = payload.agentName;
      els.agentNameEl.textContent = payload.agentName;
    }
    if (payload.workspace) els.agentWorkspaceEl.textContent = payload.workspace;
    setStatus(payload.connected ? 'Connected' : 'Offline', payload.connected ? 'Connected' : 'Offline');
  }

  // ── HTTP helpers ────────────────────────────────────────────────

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.session) headers.Authorization = `Bearer ${state.session.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...options, headers });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response — fine for error paths.
    }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  // ── Pairing ─────────────────────────────────────────────────────

  async function startPairing() {
    if (state.pairingPoll) return;
    try {
      const { token, expiresIn } = await api('/api/agent/pair', { method: 'POST', body: '{}' });
      state.pairingToken = token;
      els.pairIdle = $('pairIdle');
      els.pairIdle.style.display = 'none';
      els.pairActive.style.display = '';
      els.pairTokenValue.textContent = token;
      logLine('msg', `Pairing token created — expires in ${Math.round(expiresIn / 60)} minutes.`);
      state.pairingPoll = setInterval(pollPairing, 1500);
    } catch (err) {
      logLine('err', `Pairing failed: ${err.message}`);
    }
  }

  async function pollPairing() {
    if (!state.pairingToken) return;
    try {
      const data = await api(`/api/agent/pair/status?token=${encodeURIComponent(state.pairingToken)}`, { method: 'GET' });
      if (data.status === 'waiting') return;
      clearInterval(state.pairingPoll);
      state.pairingPoll = null;
      if (data.status === 'expired') {
        logLine('err', 'Pairing token expired. Start again.');
        resetPairingUI();
        return;
      }
      // Paired.
      state.session = { sessionId: data.sessionId, token: data.token, agentName: null };
      saveSession();
      state.pairingToken = null;
      resetPairingUI();
      showPairedUI();
      logLine('ok', 'Paired with the agent. Sending `status`…');
      openStream();
      reportModelState();
      await sendCommand('status');
    } catch (err) {
      // Server may have restarted — keep polling briefly.
      if (err.message.includes('404')) {
        clearInterval(state.pairingPoll);
        state.pairingPoll = null;
        logLine('err', 'Pairing token no longer valid. Start again.');
        resetPairingUI();
      }
    }
  }

  function resetPairingUI() {
    els.pairIdle = $('pairIdle');
    els.pairIdle.style.display = '';
    els.pairActive.style.display = 'none';
    els.pairTokenValue.textContent = '';
  }

  function cancelPairing() {
    if (state.pairingPoll) {
      clearInterval(state.pairingPoll);
      state.pairingPoll = null;
    }
    state.pairingToken = null;
    resetPairingUI();
  }

  // ── UI SSE stream ───────────────────────────────────────────────

  async function openStream() {
    if (!state.session || state.streamOpen) return;
    state.streamOpen = true;
    state.streamAbort = new AbortController();
    const url = `/api/agent/stream?session=${encodeURIComponent(state.session.sessionId)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${state.session.token}` },
        signal: state.streamAbort.signal,
      });
      if (!res.ok) throw new Error(`stream HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let event;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            handleEvent(event);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      logLine('err', `Stream error: ${err.message}`);
    } finally {
      state.streamOpen = false;
      state.streamAbort = null;
      // Reconnect unless the user disconnected or the session was revoked.
      if (state.session && !document.hidden) {
        setTimeout(openStream, 2000);
      }
    }
  }

  function closeStream() {
    if (state.streamAbort) {
      state.streamAbort.abort();
      state.streamAbort = null;
    }
    state.streamOpen = false;
  }

  // ── Events from the agent ───────────────────────────────────────

  function handleEvent(event) {
    notifyListeners(event);
    switch (event.type) {
      case 'hello':
        applyHello(event);
        break;
      case 'status':
        if (event.status === 'connected') setStatus(true, 'Connected');
        else if (event.status === 'disconnected') setStatus(false, 'Offline');
        if (event.agentName) {
          if (state.session) state.session.agentName = event.agentName;
          els.agentNameEl.textContent = event.agentName;
        }
        if (event.workspace) els.agentWorkspaceEl.textContent = event.workspace;
        break;
      case 'command-start':
        logLine('cmd', `$ ${event.command}`);
        els.agentStopBtn.style.display = '';
        break;
      case 'output':
        for (const line of String(event.text).split('\n')) {
          if (!line) continue;
          logLine(event.stream === 'stderr' ? 'err' : 'out', line);
        }
        break;
      case 'command-end':
        els.agentStopBtn.style.display = 'none';
        if (event.canceled) logLine('warn', `⏹ canceled (${event.durationMs}ms)`);
        else if (event.timedOut) logLine('err', `⏱ timed out (${event.durationMs}ms)`);
        else logLine(event.exitCode === 0 ? 'ok' : 'err', `exit ${event.exitCode} (${event.durationMs}ms)`);
        break;
      case 'message':
        logLine('msg', event.text);
        break;
      case 'fs':
        logLine(event.ok ? 'ok' : 'err', `${event.ok ? '✓' : '✗'} ${event.op} ${event.path}${event.to ? ` → ${event.to}` : ''}`);
        break;
      case 'permission-request':
        state.permRequest = { requestId: event.requestId, scope: event.scope, detail: event.detail };
        els.permText.textContent = `The agent requests permission: ${event.scope} — ${event.detail}`;
        els.permBanner.style.display = 'flex';
        break;
      case 'revoke':
        clearSession();
        closeStream();
        showPairingUI();
        setStatus(false, 'Offline');
        logLine('err', 'Session revoked.');
        break;
      default:
        break;
    }
  }

  // ── Sending ─────────────────────────────────────────────────────

  async function sendCommand(command) {
    if (!state.session) return;
    const text = String(command).trim();
    if (!text) return;
    reportModelState();
    try {
      await api('/api/agent/command', { method: 'POST', body: JSON.stringify({ command: text }) });
    } catch (err) {
      logLine('err', `Send failed: ${err.message}`);
    }
  }

  async function sendPermission(granted) {
    if (!state.permRequest || !state.session) return;
    const requestId = state.permRequest.requestId;
    state.permRequest = null;
    els.permBanner.style.display = 'none';
    try {
      await api('/api/agent/permission-response', {
        method: 'POST',
        body: JSON.stringify({ requestId, granted }),
      });
    } catch (err) {
      logLine('err', `Permission response failed: ${err.message}`);
    }
  }

  // Respond to a permission request relayed from a chat-delegated task.
  async function respondPermission(requestId, granted) {
    if (!state.session || !requestId) return;
    try {
      await api('/api/agent/permission-response', {
        method: 'POST',
        body: JSON.stringify({ requestId, granted }),
      });
    } catch (err) {
      throw new Error(`Permission response failed: ${err.message}`);
    }
  }

  // Expose a small bridge for the chat UI (app.js) to delegate `/agent …`
  // commands to the paired agent and stream their events into a chat reply.
  window.prefrontalAgent = {
    isPaired: () => Boolean(state.session),
    isConnected: () => state.streamOpen && state.session !== null,
    // Open the UI SSE stream if a stored session exists but isn't streaming yet.
    ensureStream: () => {
      if (state.session && !state.streamOpen) openStream();
    },
    // Send a raw agent command. Throws if there's no session.
    send: async function (command) {
      if (!state.session) throw new Error('No agent paired — open the Agent panel and pair first.');
      const text = String(command).trim();
      if (!text) throw new Error('Empty command.');
      reportModelState();
      ensureStream();
      await api('/api/agent/command', { method: 'POST', body: JSON.stringify({ command: text }) });
    },
    respondPermission,
    // Answer an ask-user request relayed from a chat-delegated task.
    respondAsk: async function (requestId, answer) {
      if (!state.session || !requestId) return;
      await api('/api/agent/ask-response', {
        method: 'POST',
        body: JSON.stringify({ requestId, answer }),
      });
    },
    // Subscribe/unsubscribe to streamed agent events for the current session.
    onEvent: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  };

  async function disconnectAgent() {
    closeStream();
    if (state.session) {
      try {
        await api('/api/agent/revoke', { method: 'POST', body: '{}' });
      } catch {
        // The session may already be gone server-side.
      }
    }
    clearSession();
    showPairingUI();
    setStatus(false, 'Offline');
    els.agentNameEl.textContent = '—';
    els.agentWorkspaceEl.textContent = '';
    clearLog();
    logLine('msg', 'Disconnected.');
  }

  // ── Panel open / close ──────────────────────────────────────────

  async function openPanel() {
    els.agentOverlay.classList.add('open');
    if (state.session) {
      // Validate the stored session against the server.
      try {
        const info = await api('/api/agent/session', { method: 'GET' });
        state.session.agentName = info.agentName;
        els.agentWorkspaceEl.textContent = info.workspace || '';
        setStatus(info.connected, info.connected ? 'Connected' : 'Offline');
        showPairedUI();
        openStream();
        reportModelState();
      } catch {
        clearSession();
        showPairingUI();
        setStatus(false, 'Offline');
        logLine('warn', 'Stored session is no longer valid — pair again.');
      }
    }
    if (!state.session) {
      setStatus(false, 'Offline');
    }
  }

  function closePanel() {
    els.agentOverlay.classList.remove('open');
  }

  // ── Wiring ──────────────────────────────────────────────────────

  function bindEvents() {
    els.agentBtn.addEventListener('click', openPanel);
    els.agentClose.addEventListener('click', closePanel);
    els.agentOverlay.addEventListener('click', event => {
      if (event.target === els.agentOverlay) closePanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && els.agentOverlay.classList.contains('open')) closePanel();
    });
    els.pairBtn.addEventListener('click', startPairing);
    els.copyTokenBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(els.pairTokenValue.textContent).catch(() => {});
    });
    els.pairCancelBtn.addEventListener('click', cancelPairing);
    els.agentSendBtn.addEventListener('click', () => {
      const value = els.agentCommand.value;
      if (!value.trim()) return;
      sendCommand(value);
      els.agentCommand.value = '';
    });
    els.agentCommand.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        els.agentSendBtn.click();
      }
    });
    els.agentStopBtn.addEventListener('click', () => sendCommand('stop'));
    els.permAllowBtn.addEventListener('click', () => sendPermission(true));
    els.permDenyBtn.addEventListener('click', () => sendPermission(false));
    els.agentDisconnectBtn.addEventListener('click', disconnectAgent);
  }

  function init() {
    cacheEls();
    bindEvents();
    loadSession();
    logLine('muted', 'Agent panel ready. Click “Pair new agent” to connect a local Prefrontal Agent.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
