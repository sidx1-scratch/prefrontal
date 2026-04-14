/* ═══════════════════════════════════════════════════════════════
   Prefrontal — App Logic (app.js)
   Local AI via Ollama  |  100% Offline  |  No Ads
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── STATE ────────────────────────────────────────────────────────
const state = {
  chats: {},               // { id: { id, title, messages:[], created, updated } }
  activeChatId: null,
  isGenerating: false,
  abortController: null,
  settings: {
    serverUrl:    'http://localhost:11434',
    runtime:      'ollama', // 'ollama' | 'openai'
    model:        'gemma4:e2b',
    systemPrompt: 'You are Prefrontal, a helpful, honest, and harmless AI assistant. You are running entirely locally on the user\'s device with complete privacy. Be concise, clear, and friendly. Format code in fenced code blocks with the language specified.',
    temperature:  0.7,
    numCtx:       8192,
    stream:       true,
    autoScroll:   true,
    sound:        false,
    sendMode:     'enter',  // 'enter' | 'shift'
    theme:        'dark',
    apiKey:       '',
    personality:  'balanced', // tracks which preset is active
  },
  totalTokens: 0,
  profile: null,  // { deviceId, displayName, avatar, createdAt }
};

// ── PERSONALITY PRESETS ───────────────────────────────────────────
const PERSONALITY_PRESETS = {
  balanced: {
    name: 'Balanced',
    temperature: 0.7,
    systemPrompt: 'You are Prefrontal, a helpful, honest, and harmless AI assistant. You are running entirely locally on the user\'s device with complete privacy. Be concise, clear, and friendly. Format code in fenced code blocks with the language specified.',
  },
  creative: {
    name: 'Creative',
    temperature: 1.1,
    systemPrompt: 'You are Prefrontal, a creative and imaginative AI muse running entirely locally on the user\'s device. Be expressive, playful, and explore ideas with flair. Use vivid language, analogies, and original thinking. Don\'t be afraid to be surprising or unconventional. Format code in fenced code blocks.',
  },
  precise: {
    name: 'Precise',
    temperature: 0.2,
    systemPrompt: 'You are Prefrontal, a precise and factual AI assistant running entirely locally. Be concise, direct, and accurate. Avoid filler, preamble, and unnecessary repetition. Answer exactly what is asked, nothing more. Use bullet points and numbered lists where appropriate. Format code in fenced code blocks.',
  },
  developer: {
    name: 'Developer',
    temperature: 0.3,
    systemPrompt: 'You are Prefrontal, a senior software engineer and code review AI running entirely locally. Prioritize working, idiomatic code above all else. Be terse and technical — skip hand-holding and pleasantries. Always specify the language in fenced code blocks. Point out potential bugs, edge cases, and performance issues.',
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
  state.settings.personality   = preset;
  state.settings.temperature   = p.temperature;
  state.settings.systemPrompt  = p.systemPrompt;
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
  // Settings modal preset buttons
  document.querySelectorAll('.personality-preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset)
  );
  // Welcome screen pills
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

// ── DOM REFS ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const els = {
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
  userInput:        $('userInput'),
  charCount:        $('charCount'),
  sendBtn:          $('sendBtn'),
  attachBtn:        $('attachBtn'),
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
  resetSettingsBtn: $('resetSettingsBtn'),
  saveSettingsBtn:  $('saveSettingsBtn'),
  confirmOverlay:   $('confirmOverlay'),
  confirmTitle:     $('confirmTitle'),
  confirmMessage:   $('confirmMessage'),
  confirmCancel:    $('confirmCancel'),
  confirmOk:        $('confirmOk'),
  toastContainer:   $('toastContainer'),
  // Profile
  profileCard:         $('profileCard'),
  openProfileBtn:      $('openProfileBtn'),
  sidebarAvatar:       $('sidebarAvatar'),
  sidebarName:         $('sidebarName'),
  sidebarId:           $('sidebarId'),
  // Setup modal
  setupOverlay:        $('setupOverlay'),
  deviceIdPreview:     $('deviceIdPreview'),
  avatarGrid:          $('avatarGrid'),
  setupName:           $('setupName'),
  completeSetupBtn:    $('completeSetupBtn'),
  // Profile modal
  profileOverlay:      $('profileOverlay'),
  closeProfileBtn:     $('closeProfileBtn'),
  cancelProfileBtn:    $('cancelProfileBtn'),
  saveProfileBtn:      $('saveProfileBtn'),
  profilePreviewAvatar:$('profilePreviewAvatar'),
  profilePreviewName:  $('profilePreviewName'),
  profilePreviewMeta:  $('profilePreviewMeta'),
  profileAvatarGrid:   $('profileAvatarGrid'),
  profileNameInput:    $('profileNameInput'),
  profileDeviceId:     $('profileDeviceId'),
  profileCreatedAt:    $('profileCreatedAt'),
  exportProfileBtn:    $('exportProfileBtn'),
  importProfileInput:  $('importProfileInput'),
};

// ── PERSISTENCE ───────────────────────────────────────────────────
const STORAGE_KEY_CHATS    = 'prefrontal_chats';
const STORAGE_KEY_SETTINGS = 'prefrontal_settings';
const STORAGE_KEY_PROFILE  = 'prefrontal_profile';

function saveChats() {
  try { localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(state.chats)); } catch(e) {}
}
function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHATS);
    if (raw) state.chats = JSON.parse(raw);
  } catch(e) { state.chats = {}; }
}
function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings)); } catch(e) {}
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch(e) {}
}

// ── PROFILE PERSISTENCE ───────────────────────────────────────────
function saveProfile() {
  try { localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(state.profile)); } catch(e) {}
}
function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (raw) { state.profile = JSON.parse(raw); return true; }
  } catch(e) {}
  return false;
}

// Generate a UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Short version for display: first 8 chars
const shortId = id => id ? id.slice(0, 8).toUpperCase() : '—';

// ── ID & TIMESTAMP ────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const fmtTime = ts => new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const fmtDate = ts => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {month:'short',day:'numeric'});
};

// ── TOAST ─────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warn:'⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  els.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────
function confirm(title, message) {
  return new Promise(resolve => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOverlay.classList.add('open');
    const ok = () => { cleanup(); resolve(true); };
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

// ── SOUND ─────────────────────────────────────────────────────────
function playSound(freq = 440, duration = 0.08) {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq; osc.type = 'sine';
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

// ── MARKDOWN RENDERING ────────────────────────────────────────────
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  marked.setOptions({
    highlight: (code, lang) => {
      if (hljs && lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, {language: lang}).value; } catch(e) {}
      }
      return hljs ? hljs.highlightAuto(code).value : escapeHtml(code);
    },
    breaks: true, gfm: true,
  });

  let html = marked.parse(text);

  // Add copy buttons and headers to code blocks
  html = html.replace(/<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g, (_, lang, code) => {
    const l = lang || 'text';
    return `<div class="code-block-wrapper"><pre><div class="code-header"><span class="code-lang">${l}</span><button class="copy-code-btn" onclick="copyCode(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy</button></div><code class="language-${l}">${code}</code></pre></div>`;
  });
  return html;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.copyCode = function(btn) {
  const code = btn.closest('pre').querySelector('code');
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`;
    }, 2000);
  });
};

// ── CHAT MANAGEMENT ───────────────────────────────────────────────
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
    if (!state.activeChatId) {
      state.activeChatId = createChat();
    }
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
  const raw = first.content.trim().replace(/\n/g,' ');
  const title = raw.length > 48 ? raw.slice(0, 45) + '…' : raw;
  chat.title = title;
  chat.updated = Date.now();
}

function setActiveChat(id) {
  state.activeChatId = id;
  renderChatList();
  renderChat();
}

// ── RENDER CHAT LIST ──────────────────────────────────────────────
function renderChatList(filter = '') {
  const ids = Object.keys(state.chats).sort((a,b) => (state.chats[b].updated||0) - (state.chats[a].updated||0));
  const filtered = filter ? ids.filter(id => state.chats[id].title.toLowerCase().includes(filter.toLowerCase())) : ids;

  if (filtered.length === 0) {
    els.chatList.innerHTML = `<div class="empty-chat-list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><br>${filter ? 'No results found' : 'No conversations yet'}</div>`;
    return;
  }

  els.chatList.innerHTML = filtered.map(id => {
    const chat = state.chats[id];
    const active = id === state.activeChatId ? 'active' : '';
    const icon = chat.messages.length > 0 ? '💬' : '🆕';
    return `<div class="chat-item ${active}" data-id="${id}" id="chat-item-${id}">
      <div class="chat-item-icon">${icon}</div>
      <div class="chat-item-info">
        <div class="chat-item-title">${escapeHtml(chat.title)}</div>
        <div class="chat-item-date">${fmtDate(chat.updated||chat.created)} · ${chat.messages.filter(m=>m.role==='user').length} msg${chat.messages.filter(m=>m.role==='user').length!==1?'s':''}</div>
      </div>
      <div class="chat-item-actions">
        <button class="chat-item-action-btn" onclick="promptRename(event,'${id}')" title="Rename">✏️</button>
        <button class="chat-item-action-btn" onclick="promptExport(event,'${id}')" title="Export">📥</button>
        <button class="chat-item-action-btn del" onclick="promptDelete(event,'${id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');

  // Click on chat item
  filtered.forEach(id => {
    const el = document.getElementById(`chat-item-${id}`);
    if (el) el.addEventListener('click', e => {
      if (!e.target.closest('.chat-item-actions')) setActiveChat(id);
    });
  });
}

window.promptRename = function(e, id) {
  e.stopPropagation();
  const current = state.chats[id]?.title || '';
  const name = prompt('Rename conversation:', current);
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

// ── RENDER CHAT ───────────────────────────────────────────────────
function renderChat() {
  const chat = state.chats[state.activeChatId];
  if (!chat) return;

  els.topbarTitle.textContent = chat.title;
  els.messagesWrapper.innerHTML = '';

  if (chat.messages.length === 0) {
    els.welcomeScreen.style.display = '';
    return;
  }
  els.welcomeScreen.style.display = 'none';

  chat.messages.forEach(msg => appendMessageEl(msg));
  scrollToBottom(false);
  updateTokenCounter();
}

function appendMessageEl(msg) {
  const el = document.createElement('div');
  el.className = `message ${msg.role}`;
  el.dataset.id = msg.id;

  const avatarContent = msg.role === 'user'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;color:#fff"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : `<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px"><circle cx="18" cy="18" r="18" fill="url(#ag${msg.id?.slice(-4)||'x'})"/><path d="M24 14h-5.5a2.5 2.5 0 000 5H21a2.5 2.5 0 010 5h-6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="18" cy="10" r="2" fill="#fff"/><circle cx="18" cy="26" r="2" fill="#fff"/><defs><linearGradient id="ag${msg.id?.slice(-4)||'x'}" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient></defs></svg>`;

  const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
  const regenIcon = msg.role === 'assistant' ? `<button class="msg-action-btn" onclick="regenerateFrom('${msg.id}')" title="Regenerate">${regenSvg()}</button>` : '';
  const delIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`;

  const renderedContent = msg.role === 'assistant' ? renderMarkdown(msg.content) : `<p>${escapeHtml(msg.content).replace(/\n/g,'<br>')}</p>`;

  el.innerHTML = `
    <div class="msg-avatar">${avatarContent}</div>
    <div class="msg-bubble">
      <div class="msg-content">${renderedContent}</div>
      <div class="msg-meta">
        <span class="msg-time">${fmtTime(msg.timestamp)}</span>
        <div class="msg-actions">
          <button class="msg-action-btn" onclick="copyMsgContent('${msg.id}')" title="Copy">${copyIcon}</button>
          ${regenIcon}
          <button class="msg-action-btn" onclick="deleteMessage('${msg.id}')" title="Delete">${delIcon}</button>
        </div>
      </div>
    </div>`;

  els.messagesWrapper.appendChild(el);
  return el;
}

function regenSvg() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`; }

window.copyMsgContent = function(id) {
  const chat = state.chats[state.activeChatId];
  const msg = chat?.messages.find(m => m.id === id);
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
  // Keep all messages UP TO the assistant message and regenerate
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  renderChat();
  await sendRequest();
};

// ── SCROLL ────────────────────────────────────────────────────────
function scrollToBottom(smooth = true) {
  if (!state.settings.autoScroll && smooth) return;
  els.chatArea.scrollTo({ top: els.chatArea.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

// ── GENERATE / SEND ───────────────────────────────────────────────
async function sendMessage(content) {
  if (!content.trim() || state.isGenerating) return;

  const chat = state.chats[state.activeChatId];
  if (!chat) return;

  // Hide welcome, show messages
  els.welcomeScreen.style.display = 'none';

  // Add user message
  const userMsg = { id: uid(), role: 'user', content: content.trim(), timestamp: Date.now() };
  chat.messages.push(userMsg);
  appendMessageEl(userMsg);
  scrollToBottom();
  playSound(600, 0.08);

  // Update chat title from first message
  if (chat.messages.filter(m=>m.role==='user').length === 1) {
    autoTitle(state.activeChatId);
    renderChatList();
    els.topbarTitle.textContent = chat.title;
  }

  saveChats();
  updateTokenCounter();
  await sendRequest();
}

async function sendRequest() {
  const chat = state.chats[state.activeChatId];
  if (!chat || state.isGenerating) return;

  state.isGenerating = true;
  state.abortController = new AbortController();
  setSendingState(true);
  setStatus('loading', 'Generating…');

  // Build message history for API
  const messages = [];
  if (state.settings.systemPrompt.trim()) {
    messages.push({ role: 'system', content: state.settings.systemPrompt.trim() });
  }
  chat.messages.forEach(m => messages.push({ role: m.role, content: m.content }));

  // Create assistant message placeholder
  const assistantMsg = { id: uid(), role: 'assistant', content: '', timestamp: Date.now() };
  chat.messages.push(assistantMsg);

  // Create streaming element
  const msgEl = document.createElement('div');
  msgEl.className = 'message assistant';
  msgEl.dataset.id = assistantMsg.id;
  const avatarId = assistantMsg.id.slice(-4);
  msgEl.innerHTML = `
    <div class="msg-avatar">
      <svg viewBox="0 0 36 36" fill="none" style="width:20px;height:20px"><circle cx="18" cy="18" r="18" fill="url(#ag${avatarId})"/><path d="M24 14h-5.5a2.5 2.5 0 000 5H21a2.5 2.5 0 010 5h-6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="18" cy="10" r="2" fill="#fff"/><circle cx="18" cy="26" r="2" fill="#fff"/><defs><linearGradient id="ag${avatarId}" x1="0" y1="0" x2="36" y2="36"><stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient></defs></svg>
    </div>
    <div class="msg-bubble">
      <div class="msg-content"><div class="thinking-dots"><span></span><span></span><span></span></div></div>
      <div class="msg-meta"><span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span></div>
    </div>`;
  els.messagesWrapper.appendChild(msgEl);

  // Stop button
  const stopWrapper = document.createElement('div');
  stopWrapper.className = 'stop-btn-wrapper';
  stopWrapper.innerHTML = `<button class="stop-btn visible" id="stopGenBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Stop generating</button>`;
  els.messagesWrapper.appendChild(stopWrapper);
  $('stopGenBtn')?.addEventListener('click', () => {
    state.abortController?.abort();
  });

  scrollToBottom();

  const contentEl = msgEl.querySelector('.msg-content');

  try {
    let url, payload;
    
    if (state.settings.runtime === 'openai') {
      url = `${state.settings.serverUrl.replace(/\/$/, '')}/v1/chat/completions`;
      payload = {
        model: state.settings.model,
        messages,
        stream: state.settings.stream,
        temperature: state.settings.temperature,
      };
    } else {
      url = `${state.settings.serverUrl.replace(/\/$/, '')}/api/chat`;
      payload = {
        model: state.settings.model,
        messages,
        stream: state.settings.stream,
        options: {
          temperature: state.settings.temperature,
          num_ctx: state.settings.numCtx,
        },
      };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (state.settings.apiKey && state.settings.runtime === 'openai') {
      headers['Authorization'] = `Bearer ${state.settings.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: state.abortController.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Server error ${response.status}: ${err.slice(0,200)}`);
    }

    let fullText = '';

    if (state.settings.stream) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const tLine = line.trim();
          if (!tLine) continue;
          
          if (state.settings.runtime === 'openai') {
            if (tLine.startsWith('data: ')) {
              const dataStr = tLine.slice(6).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const data = JSON.parse(dataStr);
                const chunk = data.choices?.[0]?.delta?.content || '';
                if (chunk) {
                  fullText += chunk;
                  contentEl.innerHTML = renderMarkdown(fullText) + '<span class="typing-cursor"></span>';
                  if (state.settings.autoScroll) scrollToBottom();
                }
              } catch(pe) {}
            }
          } else {
            // Ollama NDJSON
            try {
              const data = JSON.parse(tLine);
              if (data.message?.content) {
                fullText += data.message.content;
                contentEl.innerHTML = renderMarkdown(fullText) + '<span class="typing-cursor"></span>';
                if (state.settings.autoScroll) scrollToBottom();
              }
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
      if (state.settings.runtime === 'openai') {
        fullText = data.choices?.[0]?.message?.content || '';
        if (data.usage?.total_tokens) {
          state.totalTokens += data.usage.total_tokens;
          updateTokenCounter();
        }
      } else {
        fullText = data.message?.content || '';
        if (data.eval_count) {
          state.totalTokens += (data.prompt_eval_count || 0) + (data.eval_count || 0);
          updateTokenCounter();
        }
      }
    }

    contentEl.innerHTML = renderMarkdown(fullText);
    assistantMsg.content = fullText;
    assistantMsg.timestamp = Date.now();

    // Re-highlight
    contentEl.querySelectorAll('pre code').forEach(el => {
      try { hljs.highlightElement(el); } catch(e) {}
    });

    playSound(440, 0.12);
    setStatus('online', `Connected to server · ${state.settings.model}`);

  } catch(err) {
    if (err.name === 'AbortError') {
      contentEl.innerHTML = renderMarkdown(assistantMsg.content || '') + '\n\n<em style="color:var(--text-muted);font-size:12px">⏹ Generation stopped</em>';
      assistantMsg.content = assistantMsg.content + '\n\n[Generation stopped]';
      toast('Generation stopped', 'info');
    } else {
      const errMsg = formatError(err);
      contentEl.innerHTML = `<div style="color:#f87171;font-size:13.5px;line-height:1.6"><strong>⚠️ Error</strong><br>${escapeHtml(errMsg)}</div>`;
      assistantMsg.content = `[Error: ${errMsg}]`;
      setStatus('error', errMsg.slice(0, 80));
      toast(errMsg, 'error', 5000);
    }
  } finally {
    // Remove stop button
    stopWrapper.remove();
    // Update meta
    const metaEl = msgEl.querySelector('.msg-meta');
    metaEl.innerHTML = `
      <span class="msg-time">${fmtTime(assistantMsg.timestamp)}</span>
      <div class="msg-actions">
        <button class="msg-action-btn" onclick="copyMsgContent('${assistantMsg.id}')" title="Copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="msg-action-btn" onclick="regenerateFrom('${assistantMsg.id}')" title="Regenerate">${regenSvg()}</button>
        <button class="msg-action-btn" onclick="deleteMessage('${assistantMsg.id}')" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>
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
  if (msg.includes('Failed to fetch') || msg.includes('fetch')) {
    return 'Cannot connect to server. Make sure your local AI runtime (Ollama or Llama.cpp) is running on the correct Server URL.';
  }
  if (msg.includes('model') || msg.includes('404')) {
    return `Model "${state.settings.model}" not found on server. Try refreshing models or pulling it.`;
  }
  return msg;
}

// ── UI STATE ─────────────────────────────────────────────────────
function setSendingState(loading) {
  els.sendBtn.disabled = loading;
  els.userInput.disabled = loading;
  if (loading) {
    els.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  } else {
    els.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    els.userInput.focus();
  }
}

function setStatus(type, text) {
  els.statusDot.className = `status-dot ${type}`;
  els.statusText.textContent = text;
}

function updateTokenCounter() {
  if (state.totalTokens > 0) {
    els.tokenCounter.textContent = `~${state.totalTokens.toLocaleString()} tokens`;
  }
}

// ── SERVER CONNECTION ─────────────────────────────────────────────
async function checkServer() {
  setStatus('loading', 'Connecting to server…');
  try {
    let url;
    if (state.settings.runtime === 'openai') {
      url = `${state.settings.serverUrl.replace(/\/$/, '')}/v1/models`;
    } else {
      url = `${state.settings.serverUrl.replace(/\/$/, '')}/api/tags`;
    }
    const headers = {};
    if (state.settings.apiKey && state.settings.runtime === 'openai') {
      headers['Authorization'] = `Bearer ${state.settings.apiKey}`;
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers });
    if (r.ok) {
      const data = await r.json();
      let models = [];
      if (state.settings.runtime === 'openai') {
        models = data.data?.map?.(m => ({ name: m.id || m.name })) || [];
      } else {
        models = data.models || [];
      }
      const modelCount = models.length;
      setStatus('online', `Connected · ${modelCount} model${modelCount !== 1 ? 's' : ''} available`);
      // Update model dot in badge
      document.querySelector('.model-dot')?.classList.remove('offline');
      return models;
    }
    throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    if (state.settings.runtime === 'openai') {
      setStatus('error', 'Server not detected — is Llama.cpp running?');
    } else {
      setStatus('error', 'Ollama not detected — open a terminal and run: ollama serve');
    }
    document.querySelector('.model-dot')?.classList.add('offline');
    return [];
  }
}

async function fetchAndShowModels() {
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

// ── EXPORT ────────────────────────────────────────────────────────
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
  download(`${chat.title.replace(/[^a-z0-9]/gi,'_')}.md`, lines.join('\n'));
  toast('Chat exported!', 'success');
}

function exportAllChats() {
  const ids = Object.keys(state.chats);
  if (ids.length === 0) { toast('No chats to export', 'warn'); return; }
  const data = { exported: new Date().toISOString(), model: state.settings.model, chats: Object.values(state.chats) };
  download('gemmachat_export.json', JSON.stringify(data, null, 2));
  toast(`Exported ${ids.length} chat${ids.length !== 1 ? 's' : ''}!`, 'success');
}

function download(filename, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type:'text/plain'}));
  a.download = filename; a.click();
}

// ── SETTINGS ─────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const hlTheme = $('hlTheme');
  if (hlTheme) {
    hlTheme.href = theme === 'light'
      ? 'vendor/highlight-light.min.css'
      : 'vendor/highlight-dark.min.css';
  }
}

function openSettings() {
  // Populate fields
  els.serverUrl.value    = state.settings.serverUrl;
  els.modelInput.value   = state.settings.model;
  els.systemPrompt.value = state.settings.systemPrompt;
  els.tempSlider.value   = state.settings.temperature;
  els.tempDisplay.textContent = parseFloat(state.settings.temperature).toFixed(2);
  if (els.tempBadge) els.tempBadge.textContent = getTempBadgeLabel(state.settings.temperature);
  els.ctxSlider.value    = state.settings.numCtx;
  els.ctxDisplay.textContent = Number(state.settings.numCtx).toLocaleString();
  els.streamToggle.checked     = state.settings.stream;
  els.autoScrollToggle.checked = state.settings.autoScroll;
  els.soundToggle.checked      = state.settings.sound;
  if (els.apiKey) els.apiKey.value = state.settings.apiKey || '';

  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === state.settings.theme);
  });
  document.querySelectorAll('.shortcut-btn').forEach(b => {
    if (b.dataset.mode) {
      b.classList.toggle('active', b.dataset.mode === state.settings.sendMode);
    }
  });
  if (els.runtimeOptions) {
    els.runtimeOptions.querySelectorAll('.shortcut-btn').forEach(b => {
      if (b.dataset.runtime) {
        b.classList.toggle('active', b.dataset.runtime === state.settings.runtime);
      }
    });
    updateServerUrlHint(state.settings.runtime);
  }

  // Sync personality presets
  syncPersonalityUI(state.settings.personality || 'balanced');

  els.settingsOverlay.classList.add('open');
  fetchAndShowModels();
}

function getServerType(url) {
  if (!url) return 'local';
  const u = url.toLowerCase();
  if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes('::1')) return 'local';
  // RFC 1918 private ranges
  if (/^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(u)) return 'lan';
  return 'external';
}

function updateServerBadge(url) {
  if (!els.serverTypeBadge) return;
  const type = getServerType(url);
  const labels = { local: '🏠 local', lan: '📡 lan', external: '🌐 external' };
  els.serverTypeBadge.textContent = labels[type] || 'local';
}

function updateServerUrlHint(runtime) {
  // The hint is now static HTML with CORS info — only update if runtime changes the default URL
  updateServerBadge(els.serverUrl?.value || '');
}

// Wire up server quick select buttons
function bindServerQuickBtns() {
  if (!els.serverQuickBtns) return;
  els.serverQuickBtns.addEventListener('click', e => {
    const btn = e.target.closest('.server-quick-btn');
    if (!btn) return;
    const url  = btn.dataset.url;
    const runtime = btn.dataset.runtime;

    if (url) {
      els.serverUrl.value = url;
      updateServerBadge(url);
      els.serverUrl.focus();

      // If it's a template URL, select the placeholder part so they can type over it
      if (url.includes('192.168.1.X')) els.serverUrl.setSelectionRange(7, 18);
      if (url.includes('myserver.example.com')) els.serverUrl.setSelectionRange(8, 28);
    }

    // Auto-switch runtime if specified
    if (runtime && els.runtimeOptions) {
      els.runtimeOptions.querySelectorAll('.shortcut-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.runtime === runtime);
      });
      updateServerUrlHint(runtime);
    } else if (url && url.includes('/v1')) {
      // Auto-detect openai API schema
      els.runtimeOptions.querySelectorAll('.shortcut-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.runtime === 'openai');
      });
      updateServerUrlHint('openai');
    }
  });

  // Live badge update as user types
  els.serverUrl?.addEventListener('input', e => updateServerBadge(e.target.value));
}

function saveSettingsFromModal() {
  state.settings.serverUrl    = els.serverUrl.value.trim() || 'http://localhost:11434';
  state.settings.model        = els.modelInput.value.trim() || 'gemma4:e2b';
  state.settings.systemPrompt = els.systemPrompt.value;
  // Parse temperature explicitly as a float and clamp to [0,2]
  const rawTemp = parseFloat(els.tempSlider.value);
  state.settings.temperature  = isNaN(rawTemp) ? 0.7 : Math.min(2, Math.max(0, rawTemp));
  state.settings.numCtx       = parseInt(els.ctxSlider.value);
  state.settings.stream       = els.streamToggle.checked;
  state.settings.autoScroll   = els.autoScrollToggle.checked;
  state.settings.sound        = els.soundToggle.checked;
  if (els.apiKey) state.settings.apiKey = els.apiKey.value.trim();

  const activeTheme = document.querySelector('.theme-btn.active')?.dataset.theme || 'dark';
  state.settings.theme = activeTheme;
  applyTheme(activeTheme);

  const activeShortcut = els.shortcutOptions?.querySelector('.shortcut-btn.active')?.dataset.mode || 'enter';
  state.settings.sendMode = activeShortcut;

  if (els.runtimeOptions) {
    const activeRuntime = els.runtimeOptions.querySelector('.shortcut-btn.active')?.dataset.runtime || 'ollama';
    state.settings.runtime = activeRuntime;
  }

  // Detect if current prompt matches any preset
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
    systemPrompt: 'You are Prefrontal, a helpful, honest, and harmless AI assistant powered by Gemma 4 E2B. You are running entirely locally on the user\'s device with complete privacy. Be concise, clear, and friendly. Format code in fenced code blocks with the language specified.',
    temperature: 0.7, numCtx: 8192, stream: true, autoScroll: true, sound: false, sendMode: 'enter', theme: 'dark',
  };
  Object.assign(state.settings, defaults);
  saveSettings();
  openSettings();
  toast('Settings reset to defaults', 'info');
}

// ── INPUT HANDLING ────────────────────────────────────────────────
function autoResizeInput() {
  const ta = els.userInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  const len = ta.value.length;
  if (len > 20000) {
    els.charCount.textContent = `${len.toLocaleString()} / 32,000`;
    els.charCount.style.display = 'block';
    els.charCount.style.color = len > 30000 ? '#f87171' : 'var(--text-muted)';
  } else {
    els.charCount.style.display = 'none';
  }
}

// ── EVENT BINDINGS ────────────────────────────────────────────────
function bindEvents() {
  bindServerQuickBtns();

  // Sidebar toggle
  els.sidebarToggle.addEventListener('click', () => {
    els.sidebar.classList.toggle('collapsed');
  });

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

  // Export / Clear all
  els.exportAllBtn.addEventListener('click', exportAllChats);
  els.clearAllBtn.addEventListener('click', async () => {
    const ok = await confirm('Clear All Conversations', 'This will permanently delete all conversations. This cannot be undone.');
    if (ok) {
      state.chats = {};
      const id = createChat();
      state.activeChatId = id;
      saveChats();
      renderChatList();
      renderChat();
      toast('All conversations cleared', 'success');
    }
  });

  // Export current chat
  els.exportChatBtn.addEventListener('click', () => exportChat(state.activeChatId));

  // Settings
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

  // Shortcut buttons / Runtime options
  document.addEventListener('click', e => {
    // Handling shortcut-btn inside shortcutOptions (Enter to Send)
    if (e.target.closest('#shortcutOptions .shortcut-btn')) {
      const btn = e.target.closest('.shortcut-btn');
      document.querySelectorAll('#shortcutOptions .shortcut-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    // Handling shortcut-btn inside runtimeOptions
    if (e.target.closest('#runtimeOptions .shortcut-btn')) {
      const btn = e.target.closest('.shortcut-btn');
      document.querySelectorAll('#runtimeOptions .shortcut-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const rt = btn.dataset.runtime;
      if (rt) {
        updateServerUrlHint(rt);
        if (rt === 'openai' && els.serverUrl.value === 'http://localhost:11434') {
          els.serverUrl.value = 'http://localhost:8080/v1'; // Auto-suggest llama.cpp default
        } else if (rt === 'ollama' && els.serverUrl.value === 'http://localhost:8080/v1') {
          els.serverUrl.value = 'http://localhost:11434';
        }
      }
    }
  });

  // Temp slider — live label update
  els.tempSlider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    els.tempDisplay.textContent = val.toFixed(2);
    if (els.tempBadge) els.tempBadge.textContent = getTempBadgeLabel(val);
    // Any manual drag = custom (deselect presets visually but keep current personality)
  });
  // Context slider
  els.ctxSlider.addEventListener('input', e => {
    els.ctxDisplay.textContent = Number(e.target.value).toLocaleString();
  });

  // Personality presets in settings modal
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
    if (!matches) {
      state.settings.personality = 'custom';
      syncPersonalityUI('custom');
    }
  });

  // Welcome screen personality pills
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

  // Input events
  els.userInput.addEventListener('input', autoResizeInput);
  els.userInput.addEventListener('keydown', e => {
    const sendOnEnter = state.settings.sendMode === 'enter';
    const shouldSend = sendOnEnter ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);
    if (shouldSend) {
      e.preventDefault();
      handleSend();
    }
  });

  // Send button
  els.sendBtn.addEventListener('click', handleSend);

  // Welcome chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      els.userInput.value = chip.dataset.prompt;
      autoResizeInput();
      handleSend();
    });
  });

  // Confirm dialog overlay
  els.confirmOverlay.addEventListener('click', e => {
    if (e.target === els.confirmOverlay) els.confirmOverlay.classList.remove('open');
  });

  // Keyboard shortcut: Ctrl+N = new chat
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
      e.preventDefault();
      els.newChatBtn.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      openSettings();
    }
    if (e.key === 'Escape') {
      els.settingsOverlay.classList.remove('open');
      els.confirmOverlay.classList.remove('open');
    }
  });
}

function handleSend() {
  const content = els.userInput.value.trim();
  if (!content || state.isGenerating) return;
  els.userInput.value = '';
  autoResizeInput();
  sendMessage(content);
}

// ── INIT ──────────────────────────────────────────────────────────
function init() {
  loadSettings();
  loadChats();
  applyTheme(state.settings.theme);

  // Restore model name in badge
  els.modelNameDisplay.textContent = state.settings.model;

  // Ensure at least one chat exists
  if (Object.keys(state.chats).length === 0) {
    const id = createChat();
    state.activeChatId = id;
  } else {
    // Pick most recent
    const ids = Object.keys(state.chats).sort((a,b) => (state.chats[b].updated||0) - (state.chats[a].updated||0));
    state.activeChatId = ids[0];
  }

  renderChatList();
  renderChat();
  bindEvents();
  checkServer();

  // Sync personality UI to saved preference
  syncPersonalityUI(state.settings.personality || 'balanced');

  // Focus input
  setTimeout(() => els.userInput.focus(), 100);
}

// ── PROFILE SYSTEM ────────────────────────────────────────────────

function initProfile() {
  const exists = loadProfile();
  if (!exists || !state.profile?.deviceId) {
    // Generate device ID and show setup
    const newId = generateUUID();
    state.profile = { deviceId: newId, displayName: '', avatar: '🧠', createdAt: new Date().toISOString() };
    showSetupModal();
  } else {
    renderProfileCard();
  }
}

function showSetupModal() {
  // Show the generated ID
  els.deviceIdPreview.textContent = state.profile.deviceId;
  // Setup avatar picker
  bindAvatarGrid(els.avatarGrid, 'setup');
  els.setupOverlay.classList.add('open');
  setTimeout(() => els.setupName.focus(), 200);

  els.completeSetupBtn.onclick = () => {
    const name = els.setupName.value.trim();
    if (!name) { els.setupName.style.borderColor = 'var(--danger)'; els.setupName.focus(); return; }
    els.setupName.style.borderColor = '';
    const selectedAvatar = els.avatarGrid.querySelector('.avatar-btn.selected')?.dataset.emoji || '🧠';
    state.profile.displayName = name;
    state.profile.avatar = selectedAvatar;
    saveProfile();
    els.setupOverlay.classList.remove('open');
    renderProfileCard();
    toast(`Welcome, ${name}! Your profile is saved locally. 🎉`, 'success', 4000);
  };

  // Enter submits
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
  // Populate preview
  updateProfilePreview();
  // Populate fields
  els.profileNameInput.value = state.profile.displayName;
  els.profileDeviceId.textContent = state.profile.deviceId;
  els.profileCreatedAt.textContent = new Date(state.profile.createdAt).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  // Sync avatar grid selection
  bindAvatarGrid(els.profileAvatarGrid, 'profile');
  syncAvatarSelection(els.profileAvatarGrid, state.profile.avatar);
  // Live preview on name change
  els.profileNameInput.oninput = () => updateProfilePreview();
  els.profileOverlay.classList.add('open');
}

function updateProfilePreview() {
  const avatar = els.profileAvatarGrid?.querySelector('.avatar-btn.selected')?.dataset.emoji || state.profile?.avatar || '🧠';
  const name   = els.profileNameInput?.value.trim() || state.profile?.displayName || 'Anonymous';
  if (els.profilePreviewAvatar) els.profilePreviewAvatar.textContent = avatar;
  if (els.profilePreviewName)   els.profilePreviewName.textContent = name;
  if (els.profilePreviewMeta)   els.profilePreviewMeta.textContent = shortId(state.profile?.deviceId);
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
  grid.querySelectorAll('.avatar-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.emoji === emoji);
  });
}

function saveProfileChanges() {
  const name = els.profileNameInput.value.trim();
  if (!name) { toast('Display name cannot be empty', 'error'); return; }
  const avatar = els.profileAvatarGrid.querySelector('.avatar-btn.selected')?.dataset.emoji || state.profile.avatar;
  state.profile.displayName = name;
  state.profile.avatar = avatar;
  saveProfile();
  renderProfileCard();
  els.profileOverlay.classList.remove('open');
  toast('Profile saved ✓', 'success');
}

function exportProfile() {
  const data = { ...state.profile, appVersion: '1.0', exportedAt: new Date().toISOString() };
  download('prefrontal_profile.json', JSON.stringify(data, null, 2));
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
        avatar:      data.avatar || '🧠',
        createdAt:   data.createdAt || new Date().toISOString(),
      };
      saveProfile();
      renderProfileCard();
      els.profileOverlay.classList.remove('open');
      toast(`Profile imported: ${state.profile.displayName} ✓`, 'success', 4000);
    } catch(err) {
      toast('Invalid profile file. Make sure it is a prefrontal_profile.json', 'error', 5000);
    }
  };
  reader.readAsText(file);
}

window.copyDeviceId = function() {
  if (!state.profile?.deviceId) return;
  navigator.clipboard.writeText(state.profile.deviceId).then(() => {
    toast('Device ID copied!', 'success');
  });
};

function bindProfileEvents() {
  // Open profile modal from sidebar card
  [els.profileCard, els.openProfileBtn].forEach(el => {
    el?.addEventListener('click', e => { e.stopPropagation(); openProfileModal(); });
  });
  // Close
  els.closeProfileBtn?.addEventListener('click', () => els.profileOverlay.classList.remove('open'));
  els.cancelProfileBtn?.addEventListener('click', () => els.profileOverlay.classList.remove('open'));
  els.profileOverlay?.addEventListener('click', e => { if (e.target === els.profileOverlay) els.profileOverlay.classList.remove('open'); });
  // Save
  els.saveProfileBtn?.addEventListener('click', saveProfileChanges);
  // Export
  els.exportProfileBtn?.addEventListener('click', exportProfile);
  // Import
  els.importProfileInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importProfile(file);
    e.target.value = '';
  });
  // Setup overlay — don't close on bg click (force completion)
  els.setupOverlay?.addEventListener('click', e => e.stopPropagation());
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  bindProfileEvents();
  initProfile();
});
