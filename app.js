/* ═══════════════════════════════════════════════════════════════
   Prefrontal — App Logic (app.js)
   Copyright (C) 2026 sidx1-scratch

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <https://www.gnu.org/licenses/>.

   Local AI via Ollama | Cloud via OpenRouter/Groq/Together/OpenAI | 100% Private
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────────
   § 1  RUNTIME CONFIGURATION
   All supported AI backends and their defaults.
   ───────────────────────────────────────────────────────────────── */

/**
 * All supported runtime backends.
 *
 * Fields:
 *   label        — display name in UI
 *   defaultUrl   — default API base URL (users can override)
 *   openaiApi    — true if backend uses OpenAI-compatible /v1/chat/completions
 *   supportsWebSearch  — true if web-search feature is available
 *   supportsFileUpload — true if backend accepts multimodal (image/file) inputs
 *   requiresKey  — true if API key is mandatory
 *   keyEnvName   — matching .env var name for server-side key
 *   defaultModel — default model string for this backend
 */
const RUNTIMES = {
  ollama: {
    label: 'Ollama',
    defaultUrl: 'http://localhost:11434',
    openaiApi: false,
    supportsWebSearch: false,
    supportsFileUpload: true,   // Ollama multimodal (llava, etc.)
    requiresKey: false,
    keyEnvName: '',
    defaultModel: 'gemma4:e2b',
  },
  openai: {
    label: 'Llama.cpp / OpenAI-compatible',
    defaultUrl: 'http://localhost:8080/v1',
    openaiApi: true,
    supportsWebSearch: true,
    supportsFileUpload: true,
    requiresKey: false,
    keyEnvName: '',
    defaultModel: 'gpt-4o',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultUrl: 'https://openrouter.ai/api/v1',
    openaiApi: true,
    supportsWebSearch: true,
    supportsFileUpload: true,
    requiresKey: true,
    keyEnvName: 'openrouterKey',
    defaultModel: 'mistralai/mistral-7b-instruct:free',
  },
  openai_direct: {
    label: 'OpenAI',
    defaultUrl: 'https://api.openai.com/v1',
    openaiApi: true,
    supportsWebSearch: true,
    supportsFileUpload: true,
    requiresKey: true,
    keyEnvName: 'openaiKey',
    defaultModel: 'gpt-4o',
  },
  groq: {
    label: 'Groq',
    defaultUrl: 'https://api.groq.com/openai/v1',
    openaiApi: true,
    supportsWebSearch: true,
    supportsFileUpload: true,
    requiresKey: true,
    keyEnvName: 'groqKey',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  together: {
    label: 'Together AI',
    defaultUrl: 'https://api.together.xyz/v1',
    openaiApi: true,
    supportsWebSearch: true,
    supportsFileUpload: true,
    requiresKey: true,
    keyEnvName: 'togetherKey',
    defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
  },
};

/** Returns the RUNTIMES config for the currently active runtime. */
const currentRuntime = () => RUNTIMES[state.settings.runtime] || RUNTIMES.ollama;

/** True when the active runtime uses the OpenAI /v1/chat/completions API. */
const isOpenAIRuntime = () => currentRuntime().openaiApi;

/** Resolved API base URL: user override in settings > runtime default. */
function getApiBaseUrl() {
  const rt = state.settings.runtime;
  const rdef = RUNTIMES[rt];
  if (!rdef) return state.settings.serverUrl;
  // For cloud runtimes the URL is fixed (but still overridable)
  return state.settings.serverUrl || rdef.defaultUrl;
}

/** Resolved API key for direct browser requests.
 * Server-side keys are never returned by /api/config; requests using them
 * are sent through /api/proxy instead.
 */
function getApiKey() {
  return state.settings.apiKey || '';
}

// Availability flags fetched from the server's .env file at startup.
const serverKeys = {};

function hasServerKey() {
  const envName = RUNTIMES[state.settings.runtime]?.keyEnvName;
  return Boolean(envName && serverKeys[envName]);
}

function shouldUseServerProxy(targetUrl) {
  if (!isOpenAIRuntime() || !hasServerKey()) return false;
  try {
    const target = new URL(targetUrl, window.location.href);
    const provider = new URL(currentRuntime().defaultUrl);
    // Custom gateways continue to work directly with a manually entered key;
    // only the known provider origin is sent to the server-side proxy.
    return target.origin === provider.origin;
  } catch {
    return false;
  }
}

/** Fetch a backend endpoint directly or through the hardened local proxy. */
async function fetchBackend(targetUrl, { method = 'GET', headers = {}, body, signal } = {}) {
  if (!shouldUseServerProxy(targetUrl)) {
    const directOptions = { method, headers, signal };
    if (body !== undefined) directOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    return fetch(targetUrl, directOptions);
  }

  return fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl,
      runtime: state.settings.runtime,
      method,
      body,
    }),
    signal,
  });
}

async function loadServerKeys() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    Object.assign(serverKeys, data);
    if (data.hasServerKeys) {
      console.info('[Prefrontal] Server-side provider keys are available through the local proxy.');
    }
  } catch {
    // Running without the proxy server (plain static file serving).
  }
}

/* ─────────────────────────────────────────────────────────────────
   § 2  STATE
   ───────────────────────────────────────────────────────────────── */

const state = {
  chats:    {},       // { id: { id, title, messages:[], created, updated } }
  activeChatId: null,
  isGenerating:   false,
  abortController: null,
  settings: {
    serverUrl:    'http://localhost:11434',
    runtime:      'ollama',
    model:        'gemma4:e2b',
    systemPrompt: "You are Prefrontal, a helpful, honest, and harmless AI assistant. You are running entirely locally on the user's device with complete privacy. Be concise, clear, and friendly.",
    temperature:  0.7,
    numCtx:       8192,
    stream:       true,
    autoScroll:   true,
    sound:        false,
    sendMode:     'enter',  // 'enter' | 'shift'
    theme:        'dark',
    apiKey:       '',       // manual override (when no .env key)
    personality:  'balanced',
    webSearch:    false,
  },
  totalTokens: 0,
  profile:     null,   // { deviceId, displayName, avatar, createdAt }

  // Pending file attachments for the next message
  attachments: [],     // [{ name, type, dataUrl, base64 }]
};

/* ─────────────────────────────────────────────────────────────────
   § 3  PERSONALITY PRESETS
   ───────────────────────────────────────────────────────────────── */

const PERSONALITY_PRESETS = {
  balanced: {
    name: 'Balanced',
    temperature: 0.7,
    systemPrompt: "You are Prefrontal, a helpful, honest, and harmless AI assistant. You are running entirely locally on the user's device with complete privacy. Be concise, clear, and friendly.",
  },
  creative: {
    name: 'Creative',
    temperature: 1.1,
    systemPrompt: "You are Prefrontal, a creative and imaginative AI muse running entirely locally on the user's device. Be expressive, playful, and explore ideas with flair. Use vivid language, metaphors, and creative thinking.",
  },
  precise: {
    name: 'Precise',
    temperature: 0.2,
    systemPrompt: "You are Prefrontal, a precise and factual AI assistant running entirely locally. Be concise, direct, and accurate. Avoid filler, preamble, and unnecessary repetition. Answer exactly what is asked.",
  },
  developer: {
    name: 'Developer',
    temperature: 0.3,
    systemPrompt: "You are Prefrontal, a senior software engineer and code review AI running entirely locally. Prioritize working, idiomatic code above all else. Be terse and technical — skip hand-holding.",
  },
  custom: {
    name: 'Custom',
    temperature: null,
    systemPrompt: null,
  },
};

function applyPersonalityPreset(preset, { updateUI = false } = {}) {
  const p = PERSONALITY_PRESETS[preset];
  if (!p || preset === 'custom') return;
  state.settings.personality  = preset;
  state.settings.temperature  = p.temperature;
  state.settings.systemPrompt = p.systemPrompt;
  if (updateUI) {
    if (els.tempSlider)   { els.tempSlider.value = p.temperature; }
    if (els.tempDisplay)  { els.tempDisplay.textContent = p.temperature.toFixed(2); }
    if (els.tempBadge)    { els.tempBadge.textContent = getTempBadgeLabel(p.temperature); }
    if (els.systemPrompt) { els.systemPrompt.value = p.systemPrompt; }
    syncPersonalityUI(preset);
  }
  saveSettings();
}

function syncPersonalityUI(preset) {
  document.querySelectorAll('.personality-preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset)
  );
  document.querySelectorAll('.personality-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset)
  );
}

function getTempBadgeLabel(val) {
  const v = parseFloat(val);
  if (v <= 0.1) return 'Deterministic';
  if (v <= 0.4) return 'Precise';
  if (v <= 0.8) return 'Balanced';
  if (v <= 1.2) return 'Creative';
  if (v <= 1.6) return 'Expressive';
  return 'Wild';
}

/* ─────────────────────────────────────────────────────────────────
   § 4  DOM REFS
   ───────────────────────────────────────────────────────────────── */

const $ = id => document.getElementById(id);

const els = {
  // Layout
  sidebar:          $('sidebar'),
  sidebarToggle:    $('sidebarToggle'),
  newChatBtn:       $('newChatBtn'),
  searchChats:      $('searchChats'),
  chatList:         $('chatList'),
  exportAllBtn:     $('exportAllBtn'),
  clearAllBtn:      $('clearAllBtn'),
  topbarTitle:      $('topbarTitle'),
  modelNameDisplay: $('modelNameDisplay'),
  modelBadge:       $('modelBadge'),
  settingsBtn:      $('settingsBtn'),
  exportChatBtn:    $('exportChatBtn'),
  chatArea:         $('chatArea'),
  welcomeScreen:    $('welcomeScreen'),
  messagesWrapper:  $('messagesWrapper'),
  statusBar:        $('statusBar'),
  statusDot:        $('statusDot'),
  statusText:       $('statusText'),
  tokenCounter:     $('tokenCounter'),

  // Input
  userInput:        $('userInput'),
  charCount:        $('charCount'),
  sendBtn:          $('sendBtn'),
  attachBtn:        $('attachBtn'),
  attachInput:      $('attachInput'),
  attachPreview:    $('attachPreview'),

  // Settings modal
  settingsOverlay:  $('settingsOverlay'),
  closeSettings:    $('closeSettings'),
  serverUrl:        $('serverUrl'),
  serverUrlHint:    $('serverUrlHint'),
  serverTypeBadge:  $('serverTypeBadge'),
  serverQuickBtns:  $('serverQuickBtns'),
  runtimeOptions:   $('runtimeOptions'),
  modelInput:       $('modelInput'),
  fetchModelsBtn:   $('fetchModelsBtn'),
  modelList:        $('modelList'),
  systemPrompt:     $('systemPrompt'),
  tempSlider:       $('tempSlider'),
  tempDisplay:      $('tempDisplay'),
  tempBadge:        $('tempBadge'),
  ctxSlider:        $('ctxSlider'),
  ctxDisplay:       $('ctxDisplay'),
  themeOptions:     $('themeOptions'),
  streamToggle:     $('streamToggle'),
  autoScrollToggle: $('autoScrollToggle'),
  soundToggle:      $('soundToggle'),
  shortcutOptions:  $('shortcutOptions'),
  apiKey:           $('apiKey'),
  webSearchGroup:   $('webSearchGroup'),
  webSearchToggle:  $('webSearchToggle'),
  fileUploadGroup:  $('fileUploadGroup'),
  resetSettingsBtn: $('resetSettingsBtn'),
  saveSettingsBtn:  $('saveSettingsBtn'),
  serverKeyStatus:  $('serverKeyStatus'),

  // Confirm dialog
  confirmOverlay:   $('confirmOverlay'),
  confirmTitle:     $('confirmTitle'),
  confirmMessage:   $('confirmMessage'),
  confirmCancel:    $('confirmCancel'),
  confirmOk:        $('confirmOk'),

  // Toast
  toastContainer:   $('toastContainer'),

  // Profile
  profileCard:          $('profileCard'),
  openProfileBtn:       $('openProfileBtn'),
  sidebarAvatar:        $('sidebarAvatar'),
  sidebarName:          $('sidebarName'),
  sidebarId:            $('sidebarId'),
  setupOverlay:         $('setupOverlay'),
  deviceIdPreview:      $('deviceIdPreview'),
  avatarGrid:           $('avatarGrid'),
  setupName:            $('setupName'),
  completeSetupBtn:     $('completeSetupBtn'),
  profileOverlay:       $('profileOverlay'),
  closeProfileBtn:      $('closeProfileBtn'),
  cancelProfileBtn:     $('cancelProfileBtn'),
  saveProfileBtn:       $('saveProfileBtn'),
  profilePreviewAvatar: $('profilePreviewAvatar'),
  profilePreviewName:   $('profilePreviewName'),
  profilePreviewMeta:   $('profilePreviewMeta'),
  profileAvatarGrid:    $('profileAvatarGrid'),
  profileNameInput:     $('profileNameInput'),
  profileDeviceId:      $('profileDeviceId'),
  profileCreatedAt:     $('profileCreatedAt'),
  exportProfileBtn:     $('exportProfileBtn'),
  importProfileInput:   $('importProfileInput'),
};

/* ─────────────────────────────────────────────────────────────────
   § 5  PERSISTENCE
   ───────────────────────────────────────────────────────────────── */

const STORAGE_KEY_CHATS    = 'prefrontal_chats';
const STORAGE_KEY_SETTINGS = 'prefrontal_settings';
const STORAGE_KEY_PROFILE  = 'prefrontal_profile';

function saveChats()    { try { localStorage.setItem(STORAGE_KEY_CHATS,    JSON.stringify(state.chats));    } catch(e) {} }
function loadChats()    { try { const r = localStorage.getItem(STORAGE_KEY_CHATS);    if (r) state.chats   = JSON.parse(r); } catch(e) { state.chats = {}; } }
function saveSettings() { try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings)); } catch(e) {} }
function loadSettings() { try { const r = localStorage.getItem(STORAGE_KEY_SETTINGS); if (r) Object.assign(state.settings, JSON.parse(r)); } catch(e) {} }
function saveProfile()  { try { localStorage.setItem(STORAGE_KEY_PROFILE,  JSON.stringify(state.profile));  } catch(e) {} }
function loadProfile()  {
  try {
    const r = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (r) { state.profile = JSON.parse(r); return true; }
  } catch(e) {}
  return false;
}

/* ─────────────────────────────────────────────────────────────────
   § 6  UTILITIES
   ───────────────────────────────────────────────────────────────── */

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const shortId = id => id ? id.slice(0, 8).toUpperCase() : '—';
const uid     = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = ts => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function download(filename, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = filename;
  a.click();
}

/* ─────────────────────────────────────────────────────────────────
   § 7  TOAST & CONFIRM
   ───────────────────────────────────────────────────────────────── */

function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  els.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function confirm(title, message) {
  return new Promise(resolve => {
    els.confirmTitle.textContent   = title;
    els.confirmMessage.textContent = message;
    els.confirmOverlay.classList.add('open');
    const ok     = () => { cleanup(); resolve(true);  };
    const cancel = () => { cleanup(); resolve(false); };
    function cleanup() {
      els.confirmOverlay.classList.remove('open');
      els.confirmOk.removeEventListener('click', ok);
      els.confirmCancel.removeEventListener('click', cancel);
    }
    els.confirmOk.addEventListener('click', ok);
    els.confirmCancel.addEventListener('click', cancel);
  });
}

/* ─────────────────────────────────────────────────────────────────
   § 8  SOUND
   ───────────────────────────────────────────────────────────────── */

function playSound(freq = 440, duration = 0.08) {
  if (!state.settings.sound) return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq; osc.type = 'sine';
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

/* ─────────────────────────────────────────────────────────────────
   § 9  MARKDOWN RENDERING
   ───────────────────────────────────────────────────────────────── */

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  marked.setOptions({
    highlight: (code, lang) => {
      if (hljs && lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
      }
      return hljs ? hljs.highlightAuto(code).value : escapeHtml(code);
    },
    breaks: true, gfm: true,
  });

  let html = marked.parse(text);

  // Add copy buttons + language badge to code blocks
  html = html.replace(/<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g, (_, lang, code) => {
    const l = lang || 'text';
    return `<div class="code-block-wrapper"><pre><div class="code-header"><span class="code-lang">${l}</span><button class="copy-code-btn" onclick="copyCode(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M16 3H7a2 2 0 00-2 2v13a2 2 0 002 2h9a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg></button></div><code>${code}</code></pre></div>`;
  });
  return html;
}

// Expose the UI's current model selection so the agent panel (agent.js) can
// report it to the server. This keeps the agent's `task` planner in sync with
// exactly what the user has selected in the Prefrontal UI.
window.getPrefrontalModelState = function () {
  return {
    runtime: state.settings.runtime || '',
    model: state.settings.model || '',
    serverUrl: state.settings.serverUrl || '',
  };
};

window.copyCode = function(btn) {
  const code = btn.closest('pre').querySelector('code');
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M16 3H7a2 2 0 00-2 2v13a2 2 0 002 2h9a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg>`;
    }, 2000);
  });
};

/* ─────────────────────────────────────────────────────────────────
   § 10  FILE ATTACHMENTS
   Handle image / document attachments that are sent alongside messages.
   ───────────────────────────────────────────────────────────────── */

/**
 * Read a File object into a base64 data-URL and push it onto state.attachments.
 */
function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;                  // data:<mime>;base64,<data>
      const base64  = dataUrl.split(',')[1];
      const attach  = { name: file.name, type: file.type, dataUrl, base64 };
      state.attachments.push(attach);
      resolve(attach);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Build the multimodal content array for an OpenAI-style API request.
 * Combines text with any pending attachments.
 */
function buildOpenAIContent(text, attachments) {
  if (!attachments || attachments.length === 0) {
    return text;  // Plain string for text-only messages
  }
  const parts = [];
  // Image parts first
  for (const att of attachments) {
    if (att.type.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: { url: att.dataUrl, detail: 'auto' },
      });
    } else {
      // For non-image files, embed as a text block with the file name + base64
      parts.push({
        type: 'text',
        text: `[File: ${att.name}]\n\`\`\`\n${atob(att.base64).slice(0, 8000)}\n\`\`\``,
      });
    }
  }
  // User text last
  if (text) {
    parts.push({ type: 'text', text });
  }
  return parts;
}

/**
 * Build the images array for Ollama's /api/chat endpoint.
 * Ollama accepts bare base64 strings (no data-URL prefix) in the `images` array.
 */
function buildOllamaImages(attachments) {
  if (!attachments || attachments.length === 0) return undefined;
  const images = attachments
    .filter(a => a.type.startsWith('image/'))
    .map(a => a.base64);
  return images.length > 0 ? images : undefined;
}

/** Render the current attachment preview bar. */
function renderAttachPreview() {
  if (!els.attachPreview) return;
  if (state.attachments.length === 0) {
    els.attachPreview.innerHTML = '';
    els.attachPreview.style.display = 'none';
    return;
  }
  els.attachPreview.style.display = 'flex';
  els.attachPreview.innerHTML = state.attachments.map((att, i) => {
    const isImage = att.type.startsWith('image/');
    const thumb   = isImage
      ? `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}" class="attach-thumb" />`
      : `<span class="attach-file-icon">📄</span>`;
    return `
      <div class="attach-chip" data-idx="${i}">
        ${thumb}
        <span class="attach-chip-name">${escapeHtml(att.name)}</span>
        <button class="attach-chip-remove" onclick="removeAttachment(${i})" title="Remove">✕</button>
      </div>`;
  }).join('');
}

window.removeAttachment = function(idx) {
  state.attachments.splice(idx, 1);
  renderAttachPreview();
};

/** Render the user message bubble including any attachments. */
function renderUserMessageContent(msg) {
  let html = '';
  if (msg.attachments && msg.attachments.length > 0) {
    html += `<div class="msg-attachments">`;
    for (const att of msg.attachments) {
      if (att.type.startsWith('image/')) {
        html += `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}" class="msg-attach-img" onclick="openImgLightbox(this)" />`;
      } else {
        html += `<div class="msg-attach-file"><span>📄</span> ${escapeHtml(att.name)}</div>`;
      }
    }
    html += `</div>`;
  }
  if (msg.content) {
    html += `<p>${escapeHtml(msg.content).replace(/\n/g, '<br>')}</p>`;
  }
  return html;
}

/* ─────────────────────────────────────────────────────────────────
   § 11  IMAGE GENERATION
   ───────────────────────────────────────────────────────────────── */

// Keywords that indicate an image-generation model
const IMAGE_GEN_MODEL_PATTERNS = [
  /dall[-_]?e/i, /flux/i, /sdxl/i, /stable[-_]?diff/i, /imagen/i,
  /midjourney/i, /playground/i, /juggernaut/i, /dreamshaper/i,
  /realvis/i, /animagine/i, /waifu/i, /latent/i, /diffusion/i,
];

function isImageGenModel(modelName) {
  if (!modelName) return false;
  return IMAGE_GEN_MODEL_PATTERNS.some(p => p.test(modelName));
}

function extractInlineImages(text) {
  const results = [];
  const mdRe = /!\[([^\]]*)\]\((data:image\/[^)]+)\)/g;
  let m;
  while ((m = mdRe.exec(text)) !== null) {
    results.push({ src: m[2], altText: m[1] || 'Generated image' });
  }
  const b64Re = /(?:^|\s)((?:[A-Za-z0-9+/]{4}){50,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)/gm;
  while ((m = b64Re.exec(text)) !== null) {
    const candidate = m[1].trim();
    try {
      const bytes = atob(candidate.slice(0, 16));
      const isPng = bytes.charCodeAt(0) === 0x89 && bytes.charCodeAt(1) === 0x50;
      const isJpg = bytes.charCodeAt(0) === 0xFF && bytes.charCodeAt(1) === 0xD8;
      if (isPng || isJpg) {
        results.push({ src: `data:image/${isPng ? 'png' : 'jpeg'};base64,${candidate}`, altText: 'Generated image' });
      }
    } catch(e) {}
  }
  return results;
}

function stripInlineImages(text) {
  return text.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/g, '').trim();
}

function buildImageCardHtml(images, msgId) {
  if (!images || images.length === 0) return '';
  return images.map((img, i) => {
    const idx = `${msgId}-img-${i}`;
    return `
    <div class="img-gen-card" id="${idx}-card">
      <div class="img-gen-frame">
        <img class="img-gen-img" id="${idx}" src="${img.src}" alt="${escapeHtml(img.altText || 'Generated image')}" loading="lazy" />
        <div class="img-gen-overlay">
          <button class="img-dl-btn" onclick="downloadGeneratedImage('${idx}')" title="Download image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
          <button class="img-copy-btn" onclick="copyGeneratedImage('${idx}')" title="Copy image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Copy
          </button>
        </div>
      </div>
      <div class="img-gen-meta">
        <span class="img-gen-badge">🖼️ AI Generated</span>
        <span class="img-gen-size" id="${idx}-size">Loading…</span>
      </div>
    </div>`;
  }).join('');
}

window.downloadGeneratedImage = function(imgId) {
  const img = document.getElementById(imgId);
  if (!img) return;
  const canvas = document.createElement('canvas');
  canvas.width  = img.naturalWidth  || 1024;
  canvas.height = img.naturalHeight || 1024;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) { toast('Could not export image', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `prefrontal-image-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Image downloaded!', 'success');
  }, 'image/png');
};

window.copyGeneratedImage = async function(imgId) {
  const img = document.getElementById(imgId);
  if (!img) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth  || 1024;
    canvas.height = img.naturalHeight || 1024;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied to clipboard!', 'success');
  } catch(e) {
    toast('Clipboard copy failed — try downloading instead', 'warn');
  }
};

function attachImgSizeLabels(container) {
  container.querySelectorAll('.img-gen-img').forEach(img => {
    const sizeEl = document.getElementById(img.id + '-size');
    if (!sizeEl) return;
    const update = () => { if (img.naturalWidth) sizeEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}px`; };
    if (img.complete) update(); else img.addEventListener('load', update);
  });
}

/** Simple image lightbox */
window.openImgLightbox = function(imgEl) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<div class="lightbox-content"><img src="${imgEl.src}" alt="${imgEl.alt}" /><button class="lightbox-close" onclick="this.closest('.lightbox-overlay').remove()">✕</button></div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

/* ─────────────────────────────────────────────────────────────────
   § 12  IMAGE GENERATION REQUEST
   ───────────────────────────────────────────────────────────────── */

async function sendImageGenerationRequest(prompt) {
  const chat = state.chats[state.activeChatId];
  if (!chat || state.isGenerating) return;

  state.isGenerating    = true;
  state.abortController = new AbortController();
  setSendingState(true);
  setStatus('loading', 'Generating image…');

  const assistantMsg = { id: uid(), role: 'assistant', content: '', images: [], timestamp: Date.now() };
  chat.messages.push(assistantMsg);

  const msgEl = document.createElement('div');
  msgEl.className = 'message assistant';
  msgEl.dataset.id = assistantMsg.id;
  const avatarId = assistantMsg.id.slice(-4);
  msgEl.innerHTML = `
    <div class="msg-avatar">
      <svg viewBox="0 0 36 36" fill="none" style="width:20px;height:20px"><circle cx="18" cy="18" r="18" fill="url(#ag${avatarId})"/><path d="M24 14h-5.5a2.5 2.5 0 000 5H21a2.5 2.5 0 010 5h-6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><defs><linearGradient id="ag${avatarId}" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs></svg>
    </div>
    <div class="msg-bubble">
      <div class="msg-content"><div class="img-gen-loading"><span class="img-gen-spinner"></span>Generating image…</div></div>
      <div class="msg-meta"><span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span></div>
    </div>`;
  els.messagesWrapper.appendChild(msgEl);

  const stopWrapper = document.createElement('div');
  stopWrapper.className = 'stop-btn-wrapper';
  stopWrapper.innerHTML = `<button class="stop-btn visible" id="stopGenBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1"/></svg> Stop</button>`;
  els.messagesWrapper.appendChild(stopWrapper);
  $('stopGenBtn')?.addEventListener('click', () => state.abortController?.abort());
  scrollToBottom();

  const contentEl = msgEl.querySelector('.msg-content');

  try {
    let imageSrcs = [];

    if (state.settings.runtime === 'ollama') {
      const url     = `${getApiBaseUrl().replace(/\/$/, '')}/api/generate`;
      const payload = { model: state.settings.model, prompt, stream: false };
      const res     = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: state.abortController.signal });
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
      const data         = await res.json();
      const responseText = data.response || '';
      const found        = extractInlineImages(responseText);
      if (found.length > 0) {
        imageSrcs           = found.map(f => ({ src: f.src, altText: prompt }));
        assistantMsg.content = stripInlineImages(responseText);
      } else {
        assistantMsg.content = responseText;
      }
    } else {
      // OpenAI-compatible images endpoint
      const baseUrl = getApiBaseUrl().replace(/\/$/, '');
      const url     = `${baseUrl}/images/generations`;
      const headers = { 'Content-Type': 'application/json' };
      const key     = getApiKey();
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const payload = { model: state.settings.model, prompt, n: 1, response_format: 'b64_json', size: '1024x1024' };
      const res     = await fetchBackend(url, { method: 'POST', headers, body: payload, signal: state.abortController.signal });
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      imageSrcs   = (data.data || []).map(item => ({
        src: item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url,
        altText: item.revised_prompt || prompt,
      }));
      assistantMsg.content = '';
    }

    assistantMsg.images    = imageSrcs;
    assistantMsg.timestamp = Date.now();

    if (imageSrcs.length > 0) {
      const cardHtml = buildImageCardHtml(imageSrcs, assistantMsg.id);
      const textHtml = assistantMsg.content ? renderMarkdown(assistantMsg.content) : '';
      contentEl.innerHTML = textHtml + cardHtml;
      attachImgSizeLabels(contentEl);
    } else if (assistantMsg.content) {
      contentEl.innerHTML = renderMarkdown(assistantMsg.content);
    } else {
      contentEl.innerHTML = `<em style="color:var(--text-muted);font-size:13px">No image was returned by the model.</em>`;
    }

    playSound(440, 0.12);
    setStatus('online', `Image generated · ${state.settings.model}`);

  } catch(err) {
    if (err.name === 'AbortError') {
      contentEl.innerHTML = `<em style="color:var(--text-muted);font-size:12px">⏹ Generation stopped</em>`;
      assistantMsg.content = '[Generation stopped]';
      toast('Generation stopped', 'info');
    } else {
      const errMsg = err.message || String(err);
      contentEl.innerHTML = `<div style="color:#f87171;font-size:13.5px;line-height:1.6"><strong>⚠️ Error</strong><br>${escapeHtml(errMsg)}</div>`;
      assistantMsg.content = `[Error: ${errMsg}]`;
      setStatus('error', errMsg.slice(0, 80));
      toast(errMsg, 'error', 5000);
    }
  } finally {
    stopWrapper.remove();
    const metaEl = msgEl.querySelector('.msg-meta');
    metaEl.innerHTML = `
      <span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span>
      <div class="msg-actions">
        <button class="msg-action-btn" onclick="deleteMessage('${assistantMsg.id}')" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2m4 5v6m-4-6v6"/></svg></button>
      </div>`;
    state.isGenerating = false;
    setSendingState(false);
    chat.updated = Date.now();
    saveChats();
    renderChatList();
    scrollToBottom();
  }
}

/* ─────────────────────────────────────────────────────────────────
   § 13  WEB SEARCH  (DuckDuckGo, prompt-driven)
   Available on all OpenAI-compatible runtimes (not Ollama — no internet).
   ───────────────────────────────────────────────────────────────── */

const WEB_SEARCH_INSTRUCTIONS = `You have the ability to search the web when you need current information, facts you're not sure of, or anything that could have changed since your training. To search, reply with ONLY this JSON object and nothing else — no other words, no markdown code fences, no explanation before or after it:
{"search_query": "your search terms here"}
The app will run that search and send the results back to you in a follow-up message. Once you have the results, answer the user's original question normally, in plain text, using them. Only search when it would genuinely help — for things you already know, or normal conversation, just answer directly without searching.`;

function extractSearchQuery(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj.search_query === 'string' && obj.search_query.trim()) {
      return obj.search_query.trim();
    }
  } catch(e) {}
  return null;
}

async function duckDuckGoSearch(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
  try {
    const res  = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = [];
    if (data.AbstractText) items.push({ title: data.Heading || query, url: data.AbstractURL || url, snippet: data.AbstractText });
    if (data.Answer)       items.push({ title: data.AnswerType || 'Answer', url: data.AbstractURL || url, snippet: data.Answer });
    const walkTopics = topics => {
      for (const t of topics || []) {
        if (items.length >= 6) return;
        if (t.Topics) { walkTopics(t.Topics); continue; }
        if (t.Text && t.FirstURL) items.push({ title: t.Text.split(' - ')[0].slice(0, 90), url: t.FirstURL, snippet: t.Text });
      }
    };
    walkTopics(data.RelatedTopics);
    return items.slice(0, 6);
  } catch(e) {
    return [];
  }
}

function formatSearchResultsForModel(query, items) {
  if (!items.length) {
    return `[Web search for "${query}" returned no results from DuckDuckGo. Answer using your own knowledge — mention that a live search came up empty if that's relevant. Do not search again.]`;
  }
  const lines = items.map((it, i) => `${i + 1}. ${it.title} — ${it.snippet} (${it.url})`);
  return `[Web search results for "${query}"]\n${lines.join('\n')}\n\nUsing the results above, answer the user's original question normally in plain text. Do not output JSON or search again.`;
}

function mergeSources(existing, incoming) {
  const list = existing.slice();
  for (const s of incoming || []) {
    if (!s?.url || list.some(x => x.url === s.url)) continue;
    list.push({ url: s.url, title: s.title || s.url });
  }
  return list;
}

function renderSourcesHtml(sources) {
  if (!sources || !sources.length) return '';
  const chips = sources.map(s => {
    const url   = escapeHtml(s.url);
    const title = escapeHtml(s.title || s.url);
    return `<a class="msg-source-chip" href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${title}</a>`;
  }).join('');
  return `<div class="msg-sources"><span class="msg-sources-label">🔎 Web sources</span><div class="msg-source-chips">${chips}</div></div>`;
}

/* ─────────────────────────────────────────────────────────────────
   § 14  CHAT MANAGEMENT
   ───────────────────────────────────────────────────────────────── */

function createChat() {
  const id = uid();
  state.chats[id] = { id, title: 'New Chat', messages: [], created: Date.now(), updated: Date.now() };
  return id;
}

function deleteChat(id) {
  delete state.chats[id];
  if (state.activeChatId === id) {
    const remaining = Object.keys(state.chats);
    state.activeChatId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    if (!state.activeChatId) state.activeChatId = createChat();
    renderChat();
  }
  saveChats();
  renderChatList();
}

function renameChat(id, newTitle) {
  if (state.chats[id]) {
    state.chats[id].title = newTitle || 'Untitled';
    saveChats();
    renderChatList();
    if (state.activeChatId === id) els.topbarTitle.textContent = state.chats[id].title;
  }
}

function autoTitle(id) {
  const chat = state.chats[id];
  if (!chat || chat.messages.length === 0) return;
  const first = chat.messages.find(m => m.role === 'user');
  if (!first) return;
  const raw   = first.content.trim().replace(/\n/g, ' ');
  chat.title  = raw.length > 48 ? raw.slice(0, 45) + '…' : raw;
  chat.updated = Date.now();
}

function setActiveChat(id) {
  state.activeChatId = id;
  renderChatList();
  renderChat();
}

/* ─────────────────────────────────────────────────────────────────
   § 15  RENDER CHAT LIST
   ───────────────────────────────────────────────────────────────── */

function renderChatList(filter = '') {
  const ids      = Object.keys(state.chats).sort((a, b) => (state.chats[b].updated || 0) - (state.chats[a].updated || 0));
  const filtered = filter ? ids.filter(id => state.chats[id].title.toLowerCase().includes(filter.toLowerCase())) : ids;

  if (filtered.length === 0) {
    els.chatList.innerHTML = `<div class="empty-chat-list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span>No conversations yet</span></div>`;
    return;
  }

  els.chatList.innerHTML = filtered.map(id => {
    const chat   = state.chats[id];
    const active = id === state.activeChatId ? 'active' : '';
    const icon   = chat.messages.length > 0 ? '💬' : '🆕';
    const msgs   = chat.messages.filter(m => m.role === 'user').length;
    return `<div class="chat-item ${active}" data-id="${id}" id="chat-item-${id}">
      <div class="chat-item-icon">${icon}</div>
      <div class="chat-item-info">
        <div class="chat-item-title">${escapeHtml(chat.title)}</div>
        <div class="chat-item-date">${fmtDate(chat.updated || chat.created)} · ${msgs} msg${msgs !== 1 ? 's' : ''}</div>
      </div>
      <div class="chat-item-actions">
        <button class="chat-item-action-btn" onclick="promptRename(event,'${id}')" title="Rename">✏️</button>
        <button class="chat-item-action-btn" onclick="promptExport(event,'${id}')" title="Export">📥</button>
        <button class="chat-item-action-btn del" onclick="promptDelete(event,'${id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');

  filtered.forEach(id => {
    const el = document.getElementById(`chat-item-${id}`);
    if (el) el.addEventListener('click', e => {
      if (!e.target.closest('.chat-item-actions')) setActiveChat(id);
    });
  });
}

window.promptRename = function(e, id) {
  e.stopPropagation();
  const name = prompt('Rename conversation:', state.chats[id]?.title || '');
  if (name !== null && name.trim()) renameChat(id, name.trim());
};
window.promptDelete = async function(e, id) {
  e.stopPropagation();
  const ok = await confirm('Delete Conversation', `Delete "${state.chats[id]?.title}"? This cannot be undone.`);
  if (ok) { deleteChat(id); toast('Conversation deleted', 'success'); }
};
window.promptExport = function(e, id) {
  e.stopPropagation();
  exportChat(id);
};

/* ─────────────────────────────────────────────────────────────────
   § 16  RENDER CHAT & MESSAGE ELS
   ───────────────────────────────────────────────────────────────── */

function renderChat() {
  const chat = state.chats[state.activeChatId];
  if (!chat) return;
  els.topbarTitle.textContent  = chat.title;
  els.messagesWrapper.innerHTML = '';
  if (chat.messages.length === 0) { els.welcomeScreen.style.display = ''; return; }
  els.welcomeScreen.style.display = 'none';
  chat.messages.forEach(msg => appendMessageEl(msg));
  scrollToBottom(false);
  updateTokenCounter();
}

function regenSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1015.85-5.5"/></svg>`;
}

function appendMessageEl(msg) {
  const el = document.createElement('div');
  el.className = `message ${msg.role}`;
  el.dataset.id = msg.id;

  const hasImages       = msg.images && msg.images.length > 0;
  const avatarGradStart = hasImages ? '#7c3aed' : '#10a37f';
  const avatarGradEnd   = hasImages ? '#4f46e5' : '#0d8965';

  const avatarContent = msg.role === 'user'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;color:#fff"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : `<svg viewBox="0 0 36 36" fill="none" style="width:20px;height:20px"><circle cx="18" cy="18" r="18" fill="url(#ag${msg.id?.slice(-4)||'x'})"/><path d="M24 14h-5.5a2.5 2.5 0 000 5H21a2.5 2.5 0 010 5h-6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><defs><linearGradient id="ag${msg.id?.slice(-4)||'x'}" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="${avatarGradStart}"/><stop offset="100%" stop-color="${avatarGradEnd}"/></linearGradient></defs></svg>`;

  const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
  const delIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2m4 5v6m-4-6v6"/></svg>`;
  const regenBtn = msg.role === 'assistant' && !hasImages
    ? `<button class="msg-action-btn" onclick="regenerateFrom('${msg.id}')" title="Regenerate">${regenSvg()}</button>` : '';

  let renderedContent;
  if (msg.role === 'assistant') {
    const textHtml = msg.content ? renderMarkdown(msg.content) + renderSourcesHtml(msg.sources) : '';
    const imgHtml  = hasImages ? buildImageCardHtml(msg.images, msg.id) : '';
    renderedContent = textHtml + imgHtml;
  } else {
    renderedContent = renderUserMessageContent(msg);
  }

  el.innerHTML = `
    <div class="msg-avatar">${avatarContent}</div>
    <div class="msg-bubble">
      <div class="msg-content">${renderedContent}</div>
      <div class="msg-meta">
        <span class="msg-time">${fmtTime(msg.timestamp)}</span>
        <div class="msg-actions">
          ${!hasImages ? `<button class="msg-action-btn" onclick="copyMsgContent('${msg.id}')" title="Copy">${copyIcon}</button>` : ''}
          ${regenBtn}
          <button class="msg-action-btn" onclick="deleteMessage('${msg.id}')" title="Delete">${delIcon}</button>
        </div>
      </div>
    </div>`;

  els.messagesWrapper.appendChild(el);
  if (hasImages) attachImgSizeLabels(el);
  return el;
}

window.copyMsgContent = function(id) {
  const msg = state.chats[state.activeChatId]?.messages.find(m => m.id === id);
  if (!msg) return;
  navigator.clipboard.writeText(msg.content).then(() => toast('Copied to clipboard', 'success'));
};

window.deleteMessage = function(id) {
  const chat = state.chats[state.activeChatId];
  if (!chat) return;
  chat.messages = chat.messages.filter(m => m.id !== id);
  saveChats();
  renderChat();
  toast('Message deleted', 'info');
};

window.regenerateFrom = async function(id) {
  const chat = state.chats[state.activeChatId];
  if (!chat || state.isGenerating) return;
  const idx = chat.messages.findIndex(m => m.id === id);
  if (idx === -1) return;
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  renderChat();
  await sendRequest();
};

/* ─────────────────────────────────────────────────────────────────
   § 17  SCROLL
   ───────────────────────────────────────────────────────────────── */

function scrollToBottom(smooth = true) {
  if (!state.settings.autoScroll && smooth) return;
  els.chatArea.scrollTo({ top: els.chatArea.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

/* ─────────────────────────────────────────────────────────────────
   § 18  SEND MESSAGE (orchestrator)
   ───────────────────────────────────────────────────────────────── */

async function sendMessage(content) {
  if (!content.trim() && state.attachments.length === 0) return;
  if (state.isGenerating) return;

  const chat = state.chats[state.activeChatId];
  if (!chat) return;

  els.welcomeScreen.style.display = 'none';

  // Capture and clear pending attachments
  const msgAttachments = [...state.attachments];
  state.attachments    = [];
  renderAttachPreview();

  const userMsg = {
    id: uid(), role: 'user', content: content.trim(),
    attachments: msgAttachments.length > 0 ? msgAttachments : undefined,
    timestamp: Date.now(),
  };
  chat.messages.push(userMsg);
  appendMessageEl(userMsg);
  scrollToBottom();
  playSound(600, 0.08);

  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    autoTitle(state.activeChatId);
    renderChatList();
    els.topbarTitle.textContent = chat.title;
  }

  saveChats();
  updateTokenCounter();

  if (isImageGenModel(state.settings.model)) {
    await sendImageGenerationRequest(content.trim());
  } else {
    await sendRequest();
  }
}

/* ─────────────────────────────────────────────────────────────────
   § 19  SEND REQUEST (AI completion)
   ───────────────────────────────────────────────────────────────── */

async function sendRequest() {
  const chat = state.chats[state.activeChatId];
  if (!chat || state.isGenerating) return;

  state.isGenerating    = true;
  state.abortController = new AbortController();
  setSendingState(true);
  setStatus('loading', 'Generating…');

  // Web search availability: only on OpenAI-compatible runtimes
  const webSearchEnabled = isOpenAIRuntime() && state.settings.webSearch;

  // Build message history
  const messages = [];
  let sysPrompt  = state.settings.systemPrompt.trim();
  if (webSearchEnabled) sysPrompt = (sysPrompt ? sysPrompt + '\n\n' : '') + WEB_SEARCH_INSTRUCTIONS;
  if (sysPrompt) messages.push({ role: 'system', content: sysPrompt });

  // Convert stored messages to API format (include multimodal content)
  for (const m of chat.messages) {
    if (isOpenAIRuntime()) {
      const content = buildOpenAIContent(m.content, m.attachments);
      messages.push({ role: m.role, content });
    } else {
      // Ollama: text + images array
      const msgObj = { role: m.role, content: m.content };
      const imgs   = buildOllamaImages(m.attachments);
      if (imgs) msgObj.images = imgs;
      messages.push(msgObj);
    }
  }

  // Assistant placeholder
  const assistantMsg = { id: uid(), role: 'assistant', content: '', timestamp: Date.now() };
  chat.messages.push(assistantMsg);

  const msgEl = document.createElement('div');
  msgEl.className   = 'message assistant';
  msgEl.dataset.id  = assistantMsg.id;
  const avatarId    = assistantMsg.id.slice(-4);
  msgEl.innerHTML   = `
    <div class="msg-avatar">
      <svg viewBox="0 0 36 36" fill="none" style="width:20px;height:20px"><circle cx="18" cy="18" r="18" fill="url(#ag${avatarId})"/><path d="M24 14h-5.5a2.5 2.5 0 000 5H21a2.5 2.5 0 010 5h-6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><defs><linearGradient id="ag${avatarId}" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="#10a37f"/><stop offset="100%" stop-color="#0d8965"/></linearGradient></defs></svg>
    </div>
    <div class="msg-bubble">
      <div class="msg-content"><div class="thinking-dots"><span></span><span></span><span></span></div></div>
      <div class="msg-meta"><span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span></div>
    </div>`;
  els.messagesWrapper.appendChild(msgEl);

  const stopWrapper = document.createElement('div');
  stopWrapper.className = 'stop-btn-wrapper';
  stopWrapper.innerHTML = `<button class="stop-btn visible" id="stopGenBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1"/></svg> Stop</button>`;
  els.messagesWrapper.appendChild(stopWrapper);
  $('stopGenBtn')?.addEventListener('click', () => state.abortController?.abort());
  scrollToBottom();

  const contentEl = msgEl.querySelector('.msg-content');

  // ── Core completion function ──────────────────────────────────
  async function runOneCompletion(msgsForThisCall) {
    let url, payload;

    if (isOpenAIRuntime()) {
      url = `${getApiBaseUrl().replace(/\/$/, '')}/chat/completions`;
      payload = {
        model: state.settings.model,
        messages: msgsForThisCall,
        stream: state.settings.stream,
        temperature: state.settings.temperature,
      };
    } else {
      // Ollama
      url = `${getApiBaseUrl().replace(/\/$/, '')}/api/chat`;
      payload = {
        model: state.settings.model,
        messages: msgsForThisCall,
        stream: state.settings.stream,
        options: { temperature: state.settings.temperature, num_ctx: state.settings.numCtx },
      };
    }

    const headers = { 'Content-Type': 'application/json' };
    const key     = getApiKey();
    if (key && isOpenAIRuntime()) headers['Authorization'] = `Bearer ${key}`;

    const response = await fetchBackend(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Server error ${response.status}: ${err.slice(0, 200)}`);
    }

    let text = '';

    const renderLive = () => {
      if (webSearchEnabled && text.trim().startsWith('{')) {
        contentEl.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
      } else {
        contentEl.innerHTML = renderMarkdown(text) + '<span class="typing-cursor"></span>';
      }
      if (state.settings.autoScroll) scrollToBottom();
    };

    if (state.settings.stream) {
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const tLine = line.trim();
          if (!tLine) continue;
          if (isOpenAIRuntime()) {
            if (tLine.startsWith('data: ')) {
              const dataStr = tLine.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const data  = JSON.parse(dataStr);
                const chunk = data.choices?.[0]?.delta?.content || '';
                if (chunk) { text += chunk; renderLive(); }
              } catch(pe) {}
            }
          } else {
            // Ollama NDJSON
            try {
              const data = JSON.parse(tLine);
              if (data.message?.content) { text += data.message.content; renderLive(); }
              if (data.done && data.eval_count) {
                state.totalTokens += (data.prompt_eval_count || 0) + (data.eval_count || 0);
                updateTokenCounter();
              }
            } catch(pe) {}
          }
        }
      }
    } else {
      const data = await response.json();
      if (isOpenAIRuntime()) {
        text = data.choices?.[0]?.message?.content || '';
        if (data.usage?.total_tokens) { state.totalTokens += data.usage.total_tokens; updateTokenCounter(); }
      } else {
        text = data.message?.content || '';
        if (data.eval_count) { state.totalTokens += (data.prompt_eval_count || 0) + (data.eval_count || 0); updateTokenCounter(); }
      }
      renderLive();
    }
    return text;
  }

  try {
    let callMessages = messages;
    let fullText     = '';
    let sources      = [];
    const maxSearches = 2;

    for (let searchCount = 0; ; searchCount++) {
      fullText = await runOneCompletion(callMessages);
      const query = webSearchEnabled ? extractSearchQuery(fullText) : null;
      if (!query || searchCount >= maxSearches) break;

      contentEl.innerHTML = `<div class="search-status">🔎 Searching the web for "${escapeHtml(query)}"…</div>`;
      if (state.settings.autoScroll) scrollToBottom();

      const results = await duckDuckGoSearch(query);
      sources = mergeSources(sources, results.map(r => ({ url: r.url, title: r.title })));
      callMessages = [
        ...callMessages,
        { role: 'assistant', content: fullText },
        { role: 'user', content: formatSearchResultsForModel(query, results) },
      ];
    }

    const inlineImgs = extractInlineImages(fullText);
    if (inlineImgs.length > 0) {
      assistantMsg.images  = inlineImgs.map(f => ({ src: f.src, altText: f.altText }));
      assistantMsg.content = stripInlineImages(fullText);
      const textHtml = assistantMsg.content ? renderMarkdown(assistantMsg.content) + renderSourcesHtml(sources) : '';
      const imgHtml  = buildImageCardHtml(assistantMsg.images, assistantMsg.id);
      contentEl.innerHTML = textHtml + imgHtml;
      attachImgSizeLabels(contentEl);
    } else {
      contentEl.innerHTML  = renderMarkdown(fullText) + renderSourcesHtml(sources);
      assistantMsg.content = fullText;
      assistantMsg.sources = sources;
    }
    assistantMsg.timestamp = Date.now();

    contentEl.querySelectorAll('pre code').forEach(el => {
      try { hljs.highlightElement(el); } catch(e) {}
    });

    playSound(440, 0.12);
    setStatus('online', `Connected · ${state.settings.model}`);

  } catch(err) {
    if (err.name === 'AbortError') {
      contentEl.innerHTML  = renderMarkdown(assistantMsg.content || '') + '\n\n<em style="color:var(--text-muted);font-size:12px">⏹ Generation stopped</em>';
      assistantMsg.content = assistantMsg.content + '\n\n[Generation stopped]';
      toast('Generation stopped', 'info');
    } else {
      const errMsg = formatError(err);
      contentEl.innerHTML  = `<div style="color:#f87171;font-size:13.5px;line-height:1.6"><strong>⚠️ Error</strong><br>${escapeHtml(errMsg)}</div>`;
      assistantMsg.content = `[Error: ${errMsg}]`;
      setStatus('error', errMsg.slice(0, 80));
      toast(errMsg, 'error', 5000);
    }
  } finally {
    stopWrapper.remove();
    const metaEl = msgEl.querySelector('.msg-meta');
    metaEl.innerHTML = `
      <span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span>
      <div class="msg-actions">
        <button class="msg-action-btn" onclick="copyMsgContent('${assistantMsg.id}')" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="msg-action-btn" onclick="regenerateFrom('${assistantMsg.id}')" title="Regenerate">${regenSvg()}</button>
        <button class="msg-action-btn" onclick="deleteMessage('${assistantMsg.id}')" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2m4 5v6m-4-6v6"/></svg></button>
      </div>`;
    state.isGenerating = false;
    setSendingState(false);
    chat.updated = Date.now();
    saveChats();
    renderChatList();
    scrollToBottom();
  }
}

function formatError(err) {
  const msg = err.message || String(err);
  if (msg.includes('Failed to fetch') || msg.includes('fetch')) return 'Cannot connect to server. Make sure your AI runtime is running on the correct Server URL.';
  if (msg.includes('model') || msg.includes('404'))             return `Model "${state.settings.model}" not found on server. Try refreshing models.`;
  if (msg.includes('401') || msg.includes('Unauthorized'))      return 'Authentication failed. Check your API key.';
  return msg;
}

/* ─────────────────────────────────────────────────────────────────
   § 20  UI STATE
   ───────────────────────────────────────────────────────────────── */

function setSendingState(loading) {
  els.sendBtn.disabled   = loading;
  els.userInput.disabled = loading;
  if (loading) {
    els.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  } else {
    els.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>`;
    els.userInput.focus();
  }
}

function setStatus(type, text) {
  els.statusDot.className  = `status-dot ${type}`;
  els.statusText.textContent = text;
}

function updateTokenCounter() {
  if (state.totalTokens > 0) {
    els.tokenCounter.textContent = `~${state.totalTokens.toLocaleString()} tokens`;
  }
}

/* ─────────────────────────────────────────────────────────────────
   § 21  SERVER CONNECTION & MODEL FETCHING
   ───────────────────────────────────────────────────────────────── */

async function checkServer() {
  setStatus('loading', 'Connecting…');
  try {
    const base    = getApiBaseUrl().replace(/\/$/, '');
    const isOAI   = isOpenAIRuntime();
    const url     = isOAI ? `${base}/models` : `${base}/api/tags`;
    const headers = {};
    const key     = getApiKey();
    if (key && isOAI) headers['Authorization'] = `Bearer ${key}`;

    const r = await fetchBackend(url, { method: 'GET', signal: AbortSignal.timeout(8000), headers });
    if (r.ok) {
      const data   = await r.json();
      let models   = [];
      if (isOAI) {
        models = data.data?.map?.(m => ({ name: m.id || m.name })) || [];
      } else {
        models = data.models || [];
      }
      const n = models.length;
      setStatus('online', `Connected · ${n} model${n !== 1 ? 's' : ''} available`);
      document.querySelector('.model-dot')?.classList.remove('offline');
      return models;
    }
    throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    const rt = state.settings.runtime;
    const labels = {
      openrouter:   'OpenRouter not accessible — check API key & internet',
      openai_direct:'OpenAI API not reachable — check API key & internet',
      groq:         'Groq API not reachable — check API key & internet',
      together:     'Together AI not reachable — check API key & internet',
      openai:       'Server not detected — is Llama.cpp / your server running?',
      ollama:       'Ollama not detected — run: ollama serve',
    };
    setStatus('error', labels[rt] || 'Cannot connect to server');
    document.querySelector('.model-dot')?.classList.add('offline');
    return [];
  }
}

async function fetchAndShowModels() {
  els.modelList.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Loading models…</span>';
  const models = await checkServer();
  els.modelList.innerHTML = '';
  if (models.length === 0) {
    els.modelList.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">No models found on server.</span>`;
    return;
  }
  models.forEach(m => {
    const chip = document.createElement('button');
    chip.className = `model-chip ${m.name === state.settings.model ? 'selected' : ''}`;
    chip.textContent = m.name;
    chip.onclick = () => {
      document.querySelectorAll('.model-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      els.modelInput.value = m.name;
    };
    els.modelList.appendChild(chip);
  });
}

/* ─────────────────────────────────────────────────────────────────
   § 22  EXPORT
   ───────────────────────────────────────────────────────────────── */

function exportChat(id) {
  const chat = state.chats[id];
  if (!chat || chat.messages.length === 0) { toast('No messages to export', 'warn'); return; }
  const lines = [`# ${chat.title}`, `Exported: ${new Date().toLocaleString()}`, `Model: ${state.settings.model}`, '', '---', ''];
  chat.messages.forEach(m => {
    lines.push(`### ${m.role === 'user' ? '👤 You' : '🤖 Assistant'} — ${fmtTime(m.timestamp)}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  download(`${chat.title.replace(/[^a-z0-9]/gi, '_')}.md`, lines.join('\n'));
  toast('Chat exported!', 'success');
}

function exportAllChats() {
  const ids = Object.keys(state.chats);
  if (ids.length === 0) { toast('No chats to export', 'warn'); return; }
  const data = { exported: new Date().toISOString(), model: state.settings.model, chats: Object.values(state.chats) };
  download('prefrontal_export.json', JSON.stringify(data, null, 2));
  toast(`Exported ${ids.length} chat${ids.length !== 1 ? 's' : ''}!`, 'success');
}

/* ─────────────────────────────────────────────────────────────────
   § 23  SETTINGS
   ───────────────────────────────────────────────────────────────── */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const hlTheme = $('hlTheme');
  if (hlTheme) hlTheme.href = theme === 'light' ? 'vendor/highlight-light.min.css' : 'vendor/highlight-dark.min.css';
}

function buildRuntimeButtons() {
  if (!els.runtimeOptions) return;
  els.runtimeOptions.innerHTML = Object.entries(RUNTIMES).map(([key, rt]) =>
    `<button class="shortcut-btn ${state.settings.runtime === key ? 'active' : ''}" data-runtime="${key}">${rt.label}</button>`
  ).join('');
}

function openSettings() {
  buildRuntimeButtons();

  els.serverUrl.value          = state.settings.serverUrl;
  els.modelInput.value         = state.settings.model;
  els.systemPrompt.value       = state.settings.systemPrompt;
  els.tempSlider.value         = state.settings.temperature;
  els.tempDisplay.textContent  = parseFloat(state.settings.temperature).toFixed(2);
  if (els.tempBadge) els.tempBadge.textContent = getTempBadgeLabel(state.settings.temperature);
  els.ctxSlider.value          = state.settings.numCtx;
  els.ctxDisplay.textContent   = Number(state.settings.numCtx).toLocaleString();
  els.streamToggle.checked     = state.settings.stream;
  els.autoScrollToggle.checked = state.settings.autoScroll;
  els.soundToggle.checked      = state.settings.sound;
  if (els.apiKey) els.apiKey.value = state.settings.apiKey || '';
  if (els.webSearchToggle) els.webSearchToggle.checked = !!state.settings.webSearch;

  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === state.settings.theme));
  document.querySelectorAll('#shortcutOptions .shortcut-btn').forEach(b => {
    if (b.dataset.mode) b.classList.toggle('active', b.dataset.mode === state.settings.sendMode);
  });

  updateServerUrlHint(state.settings.runtime);
  updateWebSearchVisibility(state.settings.runtime);
  updateServerKeyStatus();
  syncPersonalityUI(state.settings.personality || 'balanced');

  els.settingsOverlay.classList.add('open');
  fetchAndShowModels();
}

function getServerType(url) {
  if (!url) return 'local';
  const u = url.toLowerCase();
  if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes('::1')) return 'local';
  if (/^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(u)) return 'lan';
  return 'external';
}

function updateServerBadge(url) {
  if (!els.serverTypeBadge) return;
  const labels = { local: '🏠 local', lan: '📡 lan', external: '🌐 external' };
  els.serverTypeBadge.textContent = labels[getServerType(url)] || 'local';
}

function updateServerUrlHint(runtime) {
  updateServerBadge(els.serverUrl?.value || '');
}

/** Web search is available on all OpenAI-compatible runtimes (not Ollama). */
function updateWebSearchVisibility(runtime) {
  if (!els.webSearchGroup) return;
  const supported = RUNTIMES[runtime]?.supportsWebSearch || false;
  els.webSearchGroup.style.display = supported ? '' : 'none';
  if (els.webSearchGroup.querySelector('.setting-hint')) {
    const hint = els.webSearchGroup.querySelector('.setting-hint');
    const rtLabel = RUNTIMES[runtime]?.label || runtime;
    hint.textContent = supported
      ? `Lets the model search DuckDuckGo before answering when it decides it needs to. Available on ${rtLabel} and all OpenAI-compatible backends.`
      : 'Web search is only available on OpenAI-compatible backends (not Ollama).';
  }
}

/** Show whether a server-side .env key is active for the current runtime. */
function updateServerKeyStatus() {
  if (!els.serverKeyStatus) return;
  const envKey = RUNTIMES[state.settings.runtime]?.keyEnvName;
  if (envKey && serverKeys[envKey]) {
    els.serverKeyStatus.textContent = '✅ API key loaded from server .env — no need to enter it here.';
    els.serverKeyStatus.style.display = 'block';
    els.serverKeyStatus.style.color   = 'var(--accent-color)';
    if (els.apiKey) { els.apiKey.placeholder = 'Using server .env key'; }
  } else {
    els.serverKeyStatus.textContent = '';
    els.serverKeyStatus.style.display = 'none';
    if (els.apiKey) { els.apiKey.placeholder = 'sk-... (required for cloud providers)'; }
  }
}

function bindServerQuickBtns() {
  if (!els.serverQuickBtns) return;
  els.serverQuickBtns.addEventListener('click', e => {
    const btn = e.target.closest('.server-quick-btn');
    if (!btn) return;
    const url     = btn.dataset.url;
    const runtime = btn.dataset.runtime;

    if (url) {
      els.serverUrl.value = url;
      updateServerBadge(url);
      els.serverUrl.focus();
      if (url.includes('192.168.1.X')) els.serverUrl.setSelectionRange(7, 18);
    }

    if (runtime && els.runtimeOptions) {
      els.runtimeOptions.querySelectorAll('.shortcut-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.runtime === runtime)
      );
      updateServerUrlHint(runtime);
      updateWebSearchVisibility(runtime);
      updateServerKeyStatus();
    }
  });

  els.serverUrl?.addEventListener('input', e => updateServerBadge(e.target.value));
}

function saveSettingsFromModal() {
  state.settings.serverUrl    = els.serverUrl.value.trim() || 'http://localhost:11434';
  state.settings.model        = els.modelInput.value.trim() || 'gemma4:e2b';
  state.settings.systemPrompt = els.systemPrompt.value;
  const rawTemp               = parseFloat(els.tempSlider.value);
  state.settings.temperature  = isNaN(rawTemp) ? 0.7 : Math.min(2, Math.max(0, rawTemp));
  state.settings.numCtx       = parseInt(els.ctxSlider.value);
  state.settings.stream       = els.streamToggle.checked;
  state.settings.autoScroll   = els.autoScrollToggle.checked;
  state.settings.sound        = els.soundToggle.checked;
  if (els.apiKey) state.settings.apiKey   = els.apiKey.value.trim();
  if (els.webSearchToggle) state.settings.webSearch = els.webSearchToggle.checked;

  const activeTheme         = document.querySelector('.theme-btn.active')?.dataset.theme || 'dark';
  state.settings.theme      = activeTheme;
  applyTheme(activeTheme);

  const activeShortcut      = els.shortcutOptions?.querySelector('.shortcut-btn.active')?.dataset.mode || 'enter';
  state.settings.sendMode   = activeShortcut;

  if (els.runtimeOptions) {
    const activeRuntime     = els.runtimeOptions.querySelector('.shortcut-btn.active')?.dataset.runtime || 'ollama';
    state.settings.runtime  = activeRuntime;
    // Auto-set default URL for known cloud runtimes if user hasn't customized
    const rt = RUNTIMES[activeRuntime];
    if (rt && !state.settings.serverUrl) state.settings.serverUrl = rt.defaultUrl;
  }

  const matchedPreset = Object.entries(PERSONALITY_PRESETS).find(
    ([key, p]) => key !== 'custom' && p.systemPrompt === state.settings.systemPrompt
  );
  state.settings.personality = matchedPreset ? matchedPreset[0] : 'custom';

  els.modelNameDisplay.textContent = state.settings.model;
  saveSettings();
  checkServer();
  toast(`Settings saved ✓  (temp: ${state.settings.temperature.toFixed(2)})`, 'success');
  els.settingsOverlay.classList.remove('open');
}

function resetSettings() {
  const defaults = {
    serverUrl: 'http://localhost:11434', runtime: 'ollama', model: 'gemma4:e2b',
    systemPrompt: "You are Prefrontal, a helpful, honest, and harmless AI assistant. You are running entirely locally on the user's device with complete privacy. Be concise, clear, and friendly.",
    temperature: 0.7, numCtx: 8192, stream: true, autoScroll: true, sound: false,
    sendMode: 'enter', theme: 'dark', webSearch: false, apiKey: '',
  };
  Object.assign(state.settings, defaults);
  saveSettings();
  openSettings();
  toast('Settings reset to defaults', 'info');
}

/* ─────────────────────────────────────────────────────────────────
   § 24  INPUT HANDLING
   ───────────────────────────────────────────────────────────────── */

function autoResizeInput() {
  const ta    = els.userInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  const len   = ta.value.length;
  if (len > 20000) {
    els.charCount.textContent   = `${len.toLocaleString()} / 32,000`;
    els.charCount.style.display = 'block';
    els.charCount.style.color   = len > 30000 ? '#f87171' : 'var(--text-muted)';
  } else {
    els.charCount.style.display = 'none';
  }
}

function handleSend() {
  const content = els.userInput.value.trim();
  if (!content && state.attachments.length === 0) return;
  if (state.isGenerating) return;
  els.userInput.value = '';
  autoResizeInput();
  sendMessage(content);
}

/* ─────────────────────────────────────────────────────────────────
   § 25  EVENT BINDINGS
   ───────────────────────────────────────────────────────────────── */

function bindEvents() {
  bindServerQuickBtns();

  // Sidebar
  els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('collapsed'));

  // New chat
  els.newChatBtn.addEventListener('click', () => {
    const id = createChat();
    state.activeChatId = id;
    setActiveChat(id);
    saveChats();
    renderChatList();
    els.userInput.focus();
  });

  // Search chats
  els.searchChats.addEventListener('input', e => renderChatList(e.target.value));

  // Export / clear all
  els.exportAllBtn.addEventListener('click', exportAllChats);
  els.clearAllBtn.addEventListener('click', async () => {
    const ok = await confirm('Clear All Conversations', 'This will permanently delete all conversations. This cannot be undone.');
    if (ok) {
      state.chats = {};
      const id    = createChat();
      state.activeChatId = id;
      saveChats(); renderChatList(); renderChat();
      toast('All conversations cleared', 'success');
    }
  });

  els.exportChatBtn.addEventListener('click', () => exportChat(state.activeChatId));

  // Settings modal
  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', () => els.settingsOverlay.classList.remove('open'));
  els.settingsOverlay.addEventListener('click', e => { if (e.target === els.settingsOverlay) els.settingsOverlay.classList.remove('open'); });
  els.saveSettingsBtn.addEventListener('click', saveSettingsFromModal);
  els.resetSettingsBtn.addEventListener('click', resetSettings);
  els.fetchModelsBtn.addEventListener('click', fetchAndShowModels);

  // Theme buttons
  els.themeOptions.addEventListener('click', e => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyTheme(btn.dataset.theme);
  });

  // Runtime / shortcut option buttons (delegated)
  document.addEventListener('click', e => {
    // Keyboard shortcut (Enter/Shift+Enter to send)
    if (e.target.closest('#shortcutOptions .shortcut-btn')) {
      const btn = e.target.closest('.shortcut-btn');
      document.querySelectorAll('#shortcutOptions .shortcut-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    // Runtime selector
    if (e.target.closest('#runtimeOptions .shortcut-btn')) {
      const btn = e.target.closest('.shortcut-btn');
      document.querySelectorAll('#runtimeOptions .shortcut-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rt = btn.dataset.runtime;
      if (rt) {
        updateServerUrlHint(rt);
        updateWebSearchVisibility(rt);
        updateServerKeyStatus();
        // Auto-fill default URL for known runtimes
        const rdef = RUNTIMES[rt];
        if (rdef) els.serverUrl.value = rdef.defaultUrl;
      }
    }
  });

  // Temp / ctx sliders
  els.tempSlider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    els.tempDisplay.textContent = val.toFixed(2);
    if (els.tempBadge) els.tempBadge.textContent = getTempBadgeLabel(val);
  });
  els.ctxSlider.addEventListener('input', e => {
    els.ctxDisplay.textContent = Number(e.target.value).toLocaleString();
  });

  // Personality presets
  document.addEventListener('click', e => {
    const btn = e.target.closest('#personalityPresets .personality-preset-btn');
    if (!btn) return;
    applyPersonalityPreset(btn.dataset.preset, { updateUI: true });
  });

  // System prompt manual edit → mark as custom
  els.systemPrompt.addEventListener('input', () => {
    const matches = Object.entries(PERSONALITY_PRESETS).some(
      ([key, p]) => key !== 'custom' && p.systemPrompt === els.systemPrompt.value
    );
    if (!matches) { state.settings.personality = 'custom'; syncPersonalityUI('custom'); }
  });

  // Welcome personality pills
  const welcomeBar = $('welcomePersonalityBar');
  if (welcomeBar) {
    welcomeBar.addEventListener('click', e => {
      const pill = e.target.closest('.personality-pill');
      if (!pill) return;
      applyPersonalityPreset(pill.dataset.preset, { updateUI: false });
      syncPersonalityUI(pill.dataset.preset);
      toast(`${PERSONALITY_PRESETS[pill.dataset.preset].name} mode activated`, 'success', 2000);
    });
  }

  // ── File attachment button ────────────────────────────────────
  if (els.attachBtn) {
    els.attachBtn.addEventListener('click', () => {
      if (!els.attachInput) return;
      els.attachInput.value = '';
      els.attachInput.click();
    });
  }
  if (els.attachInput) {
    els.attachInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is too large (max 20 MB)`, 'warn'); continue; }
        await readFileAsAttachment(file);
      }
      renderAttachPreview();
      // Enable attach button always (model-agnostic; API will reject if unsupported)
    });
  }

  // Drag-and-drop file upload onto the chat area
  els.chatArea.addEventListener('dragover', e => { e.preventDefault(); els.chatArea.classList.add('dragover'); });
  els.chatArea.addEventListener('dragleave', () => els.chatArea.classList.remove('dragover'));
  els.chatArea.addEventListener('drop', async e => {
    e.preventDefault();
    els.chatArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files || []);
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is too large (max 20 MB)`, 'warn'); continue; }
      await readFileAsAttachment(file);
    }
    renderAttachPreview();
  });

  // Paste image from clipboard
  els.userInput.addEventListener('paste', async e => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    await readFileAsAttachment(file);
    renderAttachPreview();
  });

  // Input / send
  els.userInput.addEventListener('input', autoResizeInput);
  els.userInput.addEventListener('keydown', e => {
    const sendOnEnter = state.settings.sendMode === 'enter';
    const shouldSend  = sendOnEnter ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);
    if (shouldSend) { e.preventDefault(); handleSend(); }
  });
  els.sendBtn.addEventListener('click', handleSend);

  // Welcome chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      els.userInput.value = chip.dataset.prompt;
      autoResizeInput();
      handleSend();
    });
  });

  // Confirm dialog backdrop
  els.confirmOverlay.addEventListener('click', e => {
    if (e.target === els.confirmOverlay) els.confirmOverlay.classList.remove('open');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) { e.preventDefault(); els.newChatBtn.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === ',')                  { e.preventDefault(); openSettings(); }
    if (e.key === 'Escape') {
      els.settingsOverlay.classList.remove('open');
      els.confirmOverlay.classList.remove('open');
    }
  });
}

/* ─────────────────────────────────────────────────────────────────
   § 26  PROFILE SYSTEM
   ───────────────────────────────────────────────────────────────── */

function initProfile() {
  const exists = loadProfile();
  if (!exists || !state.profile?.deviceId) {
    state.profile = { deviceId: generateUUID(), displayName: '', avatar: '🧠', createdAt: new Date().toISOString() };
    showSetupModal();
  } else {
    renderProfileCard();
  }
}

function showSetupModal() {
  els.deviceIdPreview.textContent = state.profile.deviceId;
  bindAvatarGrid(els.avatarGrid, 'setup');
  els.setupOverlay.classList.add('open');
  setTimeout(() => els.setupName.focus(), 200);

  els.completeSetupBtn.onclick = () => {
    const name = els.setupName.value.trim();
    if (!name) { els.setupName.style.borderColor = 'var(--danger)'; els.setupName.focus(); return; }
    els.setupName.style.borderColor = '';
    state.profile.displayName = name;
    state.profile.avatar      = els.avatarGrid.querySelector('.avatar-btn.selected')?.dataset.emoji || '🧠';
    saveProfile();
    els.setupOverlay.classList.remove('open');
    renderProfileCard();
    toast(`Welcome, ${name}! Your profile is saved locally. 🎉`, 'success', 4000);
  };
  els.setupName.addEventListener('keydown', e => { if (e.key === 'Enter') els.completeSetupBtn.click(); });
}

function renderProfileCard() {
  if (!state.profile) return;
  els.sidebarAvatar.textContent = state.profile.avatar || '🧠';
  els.sidebarName.textContent   = state.profile.displayName || 'Anonymous';
  els.sidebarId.textContent     = shortId(state.profile.deviceId);
}

function openProfileModal() {
  if (!state.profile) return;
  updateProfilePreview();
  els.profileNameInput.value        = state.profile.displayName;
  els.profileDeviceId.textContent   = state.profile.deviceId;
  els.profileCreatedAt.textContent  = new Date(state.profile.createdAt).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  bindAvatarGrid(els.profileAvatarGrid, 'profile');
  syncAvatarSelection(els.profileAvatarGrid, state.profile.avatar);
  els.profileNameInput.oninput = () => updateProfilePreview();
  els.profileOverlay.classList.add('open');
}

function updateProfilePreview() {
  const avatar = els.profileAvatarGrid?.querySelector('.avatar-btn.selected')?.dataset?.emoji || state.profile?.avatar || '🧠';
  const name   = els.profileNameInput?.value.trim() || state.profile?.displayName || 'Anonymous';
  if (els.profilePreviewAvatar) els.profilePreviewAvatar.textContent = avatar;
  if (els.profilePreviewName)   els.profilePreviewName.textContent   = name;
  if (els.profilePreviewMeta)   els.profilePreviewMeta.textContent   = shortId(state.profile?.deviceId);
}

function bindAvatarGrid(grid, context) {
  if (!grid) return;
  grid.querySelectorAll('.avatar-btn').forEach(btn => {
    btn.onclick = () => {
      grid.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (context === 'profile') updateProfilePreview();
    };
  });
}

function syncAvatarSelection(grid, emoji) {
  if (!grid) return;
  grid.querySelectorAll('.avatar-btn').forEach(b => b.classList.toggle('selected', b.dataset.emoji === emoji));
}

function saveProfileChanges() {
  const name = els.profileNameInput.value.trim();
  if (!name) { toast('Display name cannot be empty', 'error'); return; }
  state.profile.displayName = name;
  state.profile.avatar      = els.profileAvatarGrid.querySelector('.avatar-btn.selected')?.dataset.emoji || state.profile.avatar;
  saveProfile();
  renderProfileCard();
  els.profileOverlay.classList.remove('open');
  toast('Profile saved ✓', 'success');
}

function exportProfile() {
  download('prefrontal_profile.json', JSON.stringify({ ...state.profile, appVersion: '1.2', exportedAt: new Date().toISOString() }, null, 2));
  toast('Profile exported as prefrontal_profile.json', 'success');
}

function importProfile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.deviceId) throw new Error('Invalid profile file');
      state.profile = {
        deviceId:    data.deviceId,
        displayName: data.displayName || 'Imported User',
        avatar:      data.avatar      || '🧠',
        createdAt:   data.createdAt   || new Date().toISOString(),
      };
      saveProfile();
      renderProfileCard();
      els.profileOverlay.classList.remove('open');
      toast(`Profile imported: ${state.profile.displayName} ✓`, 'success', 4000);
    } catch {
      toast('Invalid profile file. Make sure it is a prefrontal_profile.json', 'error', 5000);
    }
  };
  reader.readAsText(file);
}

window.copyDeviceId = function() {
  if (!state.profile?.deviceId) return;
  navigator.clipboard.writeText(state.profile.deviceId).then(() => toast('Device ID copied!', 'success'));
};

function bindProfileEvents() {
  [els.profileCard, els.openProfileBtn].forEach(el => {
    el?.addEventListener('click', e => { e.stopPropagation(); openProfileModal(); });
  });
  els.closeProfileBtn?.addEventListener('click',  () => els.profileOverlay.classList.remove('open'));
  els.cancelProfileBtn?.addEventListener('click', () => els.profileOverlay.classList.remove('open'));
  els.profileOverlay?.addEventListener('click', e => { if (e.target === els.profileOverlay) els.profileOverlay.classList.remove('open'); });
  els.saveProfileBtn?.addEventListener('click',    saveProfileChanges);
  els.exportProfileBtn?.addEventListener('click',  exportProfile);
  els.importProfileInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importProfile(file);
    e.target.value = '';
  });
  els.setupOverlay?.addEventListener('click', e => e.stopPropagation());
}

/* ─────────────────────────────────────────────────────────────────
   § 27  INIT
   ───────────────────────────────────────────────────────────────── */

function init() {
  loadSettings();
  loadChats();
  applyTheme(state.settings.theme);

  els.modelNameDisplay.textContent = state.settings.model;

  if (Object.keys(state.chats).length === 0) {
    state.activeChatId = createChat();
  } else {
    const ids          = Object.keys(state.chats).sort((a, b) => (state.chats[b].updated || 0) - (state.chats[a].updated || 0));
    state.activeChatId = ids[0];
  }

  renderChatList();
  renderChat();
  bindEvents();
  checkServer();
  syncPersonalityUI(state.settings.personality || 'balanced');
  setTimeout(() => els.userInput.focus(), 100);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadServerKeys(); // Load .env keys from server first
  init();
  bindProfileEvents();
  initProfile();
});
