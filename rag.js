/**
 * Prefrontal — Local Knowledge Base (RAG) (rag.js)
 * Copyright (C) 2026 sidx1-scratch
 *
 * Dependency-free, 100% private, on-device Retrieval-Augmented Generation.
 * Indexes local text documents, markdown, and code files using BM25 with
 * smart text chunking and provides context injection for chat completions.
 * Uses browser IndexedDB with automatic localStorage fallback — zero external npm deps.
 */

(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    global.PrefrontalRAG = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Configuration & Constants ─────────────────────────────────
  const DB_NAME = 'prefrontal_rag_db';
  const DB_VERSION = 1;
  const DOC_STORE = 'documents';
  const CHUNK_STORE = 'chunks';
  const LS_SETTINGS_KEY = 'prefrontal.rag.settings';
  const LS_FALLBACK_DOCS_KEY = 'prefrontal.rag.fallback_docs';
  const LS_FALLBACK_CHUNKS_KEY = 'prefrontal.rag.fallback_chunks';

  const DEFAULT_CHUNK_SIZE = 500;   // Target character count per chunk
  const DEFAULT_CHUNK_OVERLAP = 100; // Overlap characters between consecutive chunks

  // Common English stop words to filter out from BM25 term frequency calculations
  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
    'arent', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
    'by', 'can', 'cannot', 'could', 'couldn', 'couldnt', 'did', 'didn', 'didnt', 'do', 'does', 'doesn',
    'doesnt', 'doing', 'don', 'dont', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had',
    'hadn', 'hadnt', 'has', 'hasn', 'hasnt', 'have', 'haven', 'havent', 'having', 'he', 'hed', 'hell',
    'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id',
    'ill', 'im', 'ive', 'if', 'in', 'into', 'is', 'isn', 'isnt', 'it', 'its', 'itself', 'lets', 'me',
    'more', 'most', 'mustn', 'mustnt', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
    'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan',
    'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldn', 'shouldnt', 'so', 'some', 'such',
    'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres',
    'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasn', 'wasnt', 'we', 'wed', 'well', 'were', 'werent',
    'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why',
    'whys', 'with', 'won', 'wont', 'would', 'wouldn', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve',
    'your', 'yours', 'yourself', 'yourselves'
  ]);

  // ── In-Memory State & Cache ───────────────────────────────────
  let dbInstance = null;
  let useFallbackStorage = false;
  let isReady = false;

  const inMemoryDocs = new Map();   // docId -> docObject
  const inMemoryChunks = new Map(); // chunkId -> chunkObject
  const listeners = new Set();      // Change notification callbacks

  let ragSettings = {
    enabled: true,
    topK: 4,
    minScore: 0.35,
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  };

  // ── Helper Utilities ──────────────────────────────────────────
  function uid(prefix = 'doc') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  function loadSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LS_SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          ragSettings = { ...ragSettings, ...parsed };
        }
      }
    } catch (e) {
      // Ignore localStorage read errors
    }
  }

  function saveSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(ragSettings));
      }
    } catch (e) {
      // Ignore localStorage write errors
    }
  }

  // ── Text Processing & Tokenization ────────────────────────────
  /**
   * Cleans and tokenizes text for BM25 indexing.
   * Strips accents, punctuation, and filters stop words.
   */
  function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .replace(/[^a-z0-9_\-\s]/g, ' '); // keep alphanumeric, hyphen, underscore

    const tokens = normalized.split(/\s+/).filter(token => {
      return token.length > 1 && !STOP_WORDS.has(token);
    });
    return tokens;
  }

  /**
   * Intelligently chunks text documents, attempting to break at
   * natural boundaries (paragraphs, sentences, lines) while maintaining
   * an overlap window between consecutive chunks.
   */
  function chunkDocument(content, docId, docTitle, options = {}) {
    const chunkSize = options.chunkSize || ragSettings.chunkSize || DEFAULT_CHUNK_SIZE;
    const overlap = options.chunkOverlap || ragSettings.chunkOverlap || DEFAULT_CHUNK_OVERLAP;

    const text = String(content || '').trim();
    if (!text) return [];

    // If the text is shorter than or equal to chunkSize, return a single chunk
    if (text.length <= chunkSize) {
      const tokens = tokenize(text);
      return [{
        id: `${docId}_c0`,
        docId,
        docTitle,
        chunkIndex: 0,
        text,
        tokens,
        tokenCount: tokens.length,
        charCount: text.length,
      }];
    }

    // Split text into coherent paragraphs and segments
    const paragraphs = text.split(/\n\s*\n/);
    const units = [];

    for (const p of paragraphs) {
      const trimmedP = p.trim();
      if (!trimmedP) continue;

      if (trimmedP.length <= chunkSize) {
        units.push(trimmedP);
      } else {
        // Further split long paragraphs by sentence or newline
        const sentences = trimmedP.split(/(?<=[.!?\n])\s+/);
        for (const s of sentences) {
          const trimmedS = s.trim();
          if (!trimmedS) continue;

          if (trimmedS.length <= chunkSize) {
            units.push(trimmedS);
          } else {
            // Split by lines or words if individual sentence is massive
            const words = trimmedS.split(/\s+/);
            let buf = '';
            for (const w of words) {
              if ((buf + ' ' + w).length > chunkSize) {
                if (buf) units.push(buf);
                buf = w;
              } else {
                buf = buf ? buf + ' ' + w : w;
              }
            }
            if (buf) units.push(buf);
          }
        }
      }
    }

    const chunks = [];
    let currentChunk = '';
    let currentOverlap = '';

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];

      if (!currentChunk) {
        currentChunk = currentOverlap ? `${currentOverlap}\n\n${unit}` : unit;
      } else if ((currentChunk + '\n\n' + unit).length <= chunkSize) {
        currentChunk += '\n\n' + unit;
      } else {
        // Emit the finished chunk
        const chunkIndex = chunks.length;
        const tokens = tokenize(currentChunk);
        chunks.push({
          id: `${docId}_c${chunkIndex}`,
          docId,
          docTitle,
          chunkIndex,
          text: currentChunk,
          tokens,
          tokenCount: tokens.length,
          charCount: currentChunk.length,
        });

        // Compute overlap window from the end of currentChunk
        if (overlap > 0 && currentChunk.length > overlap) {
          currentOverlap = currentChunk.slice(-overlap).trim();
          // Avoid leading broken word
          const spaceIdx = currentOverlap.indexOf(' ');
          if (spaceIdx > 0 && spaceIdx < 20) {
            currentOverlap = currentOverlap.slice(spaceIdx + 1);
          }
        } else {
          currentOverlap = '';
        }

        currentChunk = currentOverlap ? `${currentOverlap}\n\n${unit}` : unit;
      }
    }

    if (currentChunk.trim()) {
      const chunkIndex = chunks.length;
      const tokens = tokenize(currentChunk);
      chunks.push({
        id: `${docId}_c${chunkIndex}`,
        docId,
        docTitle,
        chunkIndex,
        text: currentChunk,
        tokens,
        tokenCount: tokens.length,
        charCount: currentChunk.length,
      });
    }

    return chunks;
  }

  // ── BM25 Ranking Engine ───────────────────────────────────────
  /**
   * Best Matching 25 (BM25) Information Retrieval Engine.
   * Computes probabilistic relevance scores between a query and indexed document chunks.
   */
  class BM25Engine {
    constructor(k1 = 1.2, b = 0.75) {
      this.k1 = k1; // Term frequency saturation parameter
      this.b = b;   // Document length normalization parameter
    }

    search(query, chunks, topK = 4, minScore = 0.35) {
      if (!chunks || chunks.length === 0) return [];
      const queryTokens = tokenize(query);
      if (queryTokens.length === 0) return [];

      const N = chunks.length;

      // 1. Calculate Document Frequency (DF) for each query term
      const df = new Map();
      let totalLength = 0;

      for (const chunk of chunks) {
        totalLength += (chunk.tokenCount || chunk.tokens.length || 1);
        const uniqueTokens = new Set(chunk.tokens || []);
        for (const qt of queryTokens) {
          if (uniqueTokens.has(qt)) {
            df.set(qt, (df.get(qt) || 0) + 1);
          }
        }
      }

      const avgdl = totalLength / Math.max(N, 1);

      // 2. Compute IDF for each query term
      const idf = new Map();
      for (const qt of queryTokens) {
        const n = df.get(qt) || 0;
        // Standard BM25 IDF formulation with smoothing
        const idfVal = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        idf.set(qt, Math.max(idfVal, 0.05));
      }

      // 3. Score each chunk
      const scored = [];
      const lowerQuery = query.toLowerCase().trim();
      const isPhraseQuery = lowerQuery.length >= 8 && lowerQuery.includes(' ');

      for (const chunk of chunks) {
        const chunkTokens = chunk.tokens || [];
        const docLen = chunk.tokenCount || chunkTokens.length || 1;

        // Calculate term frequency in this chunk
        const tf = new Map();
        for (const t of chunkTokens) {
          tf.set(t, (tf.get(t) || 0) + 1);
        }

        let score = 0;
        let matchedTerms = 0;

        for (const qt of queryTokens) {
          const f = tf.get(qt) || 0;
          if (f > 0) {
            matchedTerms++;
            const termIdf = idf.get(qt) || 0;
            const numerator = f * (this.k1 + 1);
            const denominator = f + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
            score += termIdf * (numerator / denominator);
          }
        }

        if (matchedTerms > 0 && score > 0) {
          // Exact phrase match boost:
          if (isPhraseQuery && chunk.text.toLowerCase().includes(lowerQuery)) {
            score += 2.0;
          }

          // Document title match boost:
          if (chunk.docTitle) {
            const titleTokens = tokenize(chunk.docTitle);
            for (const qt of queryTokens) {
              if (titleTokens.includes(qt)) {
                score += 0.75;
              }
            }
          }

          if (score >= minScore) {
            scored.push({
              ...chunk,
              score: Math.round(score * 100) / 100,
              matchedTerms,
            });
          }
        }
      }

      // Sort descending by score
      scored.sort((a, b) => b.score - a.score);

      return scored.slice(0, topK);
    }
  }

  const bm25 = new BM25Engine();

  // ── Database & Storage (IndexedDB + localStorage Fallback) ────
  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DOC_STORE)) {
          db.createObjectStore(DOC_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const chunkStore = db.createObjectStore(CHUNK_STORE, { keyPath: 'id' });
          chunkStore.createIndex('docId', 'docId', { unique: false });
        }
      };

      request.onsuccess = event => resolve(event.target.result);
      request.onerror = event => reject(event.target.error);
    });
  }

  async function initStorage() {
    loadSettings();

    try {
      dbInstance = await openIndexedDB();
      useFallbackStorage = false;
      await syncFromIndexedDB();
    } catch (err) {
      if (typeof window !== 'undefined') {
        console.warn('Prefrontal RAG: IndexedDB unavailable, using localStorage fallback.', err);
      }
      useFallbackStorage = true;
      syncFromLocalStorage();
    }

    isReady = true;
    notifyUpdate();
  }

  function syncFromLocalStorage() {
    inMemoryDocs.clear();
    inMemoryChunks.clear();

    try {
      if (typeof localStorage !== 'undefined') {
        const rawDocs = localStorage.getItem(LS_FALLBACK_DOCS_KEY);
        const rawChunks = localStorage.getItem(LS_FALLBACK_CHUNKS_KEY);

        if (rawDocs) {
          const docs = JSON.parse(rawDocs);
          for (const d of docs) inMemoryDocs.set(d.id, d);
        }
        if (rawChunks) {
          const chunks = JSON.parse(rawChunks);
          for (const c of chunks) inMemoryChunks.set(c.id, c);
        }
      }
    } catch (e) {
      console.error('Prefrontal RAG: Error loading from localStorage fallback', e);
    }
  }

  function saveToLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const docs = Array.from(inMemoryDocs.values());
        const chunks = Array.from(inMemoryChunks.values());
        localStorage.setItem(LS_FALLBACK_DOCS_KEY, JSON.stringify(docs));
        localStorage.setItem(LS_FALLBACK_CHUNKS_KEY, JSON.stringify(chunks));
      }
    } catch (e) {
      console.error('Prefrontal RAG: Error saving to localStorage fallback', e);
    }
  }

  function syncFromIndexedDB() {
    return new Promise((resolve, reject) => {
      inMemoryDocs.clear();
      inMemoryChunks.clear();

      const tx = dbInstance.transaction([DOC_STORE, CHUNK_STORE], 'readonly');
      const docStore = tx.objectStore(DOC_STORE);
      const chunkStore = tx.objectStore(CHUNK_STORE);

      const docReq = docStore.getAll();
      docReq.onsuccess = () => {
        for (const doc of docReq.result || []) inMemoryDocs.set(doc.id, doc);
      };

      const chunkReq = chunkStore.getAll();
      chunkReq.onsuccess = () => {
        for (const chunk of chunkReq.result || []) inMemoryChunks.set(chunk.id, chunk);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function persistDocAndChunks(doc, chunks) {
    if (useFallbackStorage || !dbInstance) {
      inMemoryDocs.set(doc.id, doc);
      for (const c of chunks) inMemoryChunks.set(c.id, c);
      saveToLocalStorage();
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction([DOC_STORE, CHUNK_STORE], 'readwrite');
      const docStore = tx.objectStore(DOC_STORE);
      const chunkStore = tx.objectStore(CHUNK_STORE);

      docStore.put(doc);
      for (const chunk of chunks) {
        chunkStore.put(chunk);
      }

      tx.oncomplete = () => {
        inMemoryDocs.set(doc.id, doc);
        for (const c of chunks) inMemoryChunks.set(c.id, c);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  function deleteDocAndChunks(docId) {
    if (useFallbackStorage || !dbInstance) {
      inMemoryDocs.delete(docId);
      for (const [id, chunk] of inMemoryChunks.entries()) {
        if (chunk.docId === docId) inMemoryChunks.delete(id);
      }
      saveToLocalStorage();
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction([DOC_STORE, CHUNK_STORE], 'readwrite');
      const docStore = tx.objectStore(DOC_STORE);
      const chunkStore = tx.objectStore(CHUNK_STORE);

      docStore.delete(docId);

      const index = chunkStore.index('docId');
      const req = index.openKeyCursor(IDBKeyRange.only(docId));

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          chunkStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        inMemoryDocs.delete(docId);
        for (const [id, chunk] of inMemoryChunks.entries()) {
          if (chunk.docId === docId) inMemoryChunks.delete(id);
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  function clearAllData() {
    if (useFallbackStorage || !dbInstance) {
      inMemoryDocs.clear();
      inMemoryChunks.clear();
      saveToLocalStorage();
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction([DOC_STORE, CHUNK_STORE], 'readwrite');
      tx.objectStore(DOC_STORE).clear();
      tx.objectStore(CHUNK_STORE).clear();

      tx.oncomplete = () => {
        inMemoryDocs.clear();
        inMemoryChunks.clear();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  function notifyUpdate() {
    for (const listener of listeners) {
      try {
        listener({
          docCount: inMemoryDocs.size,
          chunkCount: inMemoryChunks.size,
          enabled: ragSettings.enabled,
        });
      } catch (e) {
        console.error('Prefrontal RAG: listener error', e);
      }
    }
  }

  // ── Public Knowledge Base API ─────────────────────────────────
  const PrefrontalRAG = {
    /**
     * Initializes the RAG storage engine.
     */
    async init() {
      if (!isReady) {
        await initStorage();
      }
      return this;
    },

    isReady() {
      return isReady;
    },

    isEnabled() {
      return Boolean(ragSettings.enabled);
    },

    setEnabled(enabled) {
      ragSettings.enabled = Boolean(enabled);
      saveSettings();
      notifyUpdate();
    },

    getSettings() {
      return { ...ragSettings };
    },

    updateSettings(newSettings) {
      ragSettings = { ...ragSettings, ...newSettings };
      saveSettings();
      notifyUpdate();
    },

    onUpdate(fn) {
      if (typeof fn === 'function') {
        listeners.add(fn);
        fn({
          docCount: inMemoryDocs.size,
          chunkCount: inMemoryChunks.size,
          enabled: ragSettings.enabled,
        });
      }
      return () => listeners.delete(fn);
    },

    /**
     * Ingests a new document into the local knowledge base.
     */
    async addDocument({ title, content, type = 'text/plain', size = null }) {
      await this.init();

      const docTitle = String(title || 'Untitled Document').trim();
      const docContent = String(content || '').trim();

      if (!docContent) {
        throw new Error('Document content cannot be empty');
      }

      const docId = uid('doc');
      const docSize = size !== null ? size : new Blob([docContent]).size;

      // Generate chunks for BM25 retrieval
      const chunks = chunkDocument(docContent, docId, docTitle);

      const doc = {
        id: docId,
        title: docTitle,
        content: docContent,
        type,
        size: docSize,
        chunkCount: chunks.length,
        createdAt: Date.now(),
      };

      await persistDocAndChunks(doc, chunks);
      notifyUpdate();

      return { doc, chunks };
    },

    /**
     * Deletes a document and its indexed chunks.
     */
    async deleteDocument(docId) {
      await this.init();
      await deleteDocAndChunks(docId);
      notifyUpdate();
    },

    /**
     * Clears all documents and indexed chunks.
     */
    async clearAll() {
      await this.init();
      await clearAllData();
      notifyUpdate();
    },

    /**
     * Lists all stored documents.
     */
    getDocuments() {
      return Array.from(inMemoryDocs.values()).sort((a, b) => b.createdAt - a.createdAt);
    },

    /**
     * Retrieves all chunks for a document.
     */
    getChunksForDocument(docId) {
      return Array.from(inMemoryChunks.values())
        .filter(c => c.docId === docId)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
    },

    /**
     * Searches the local knowledge base using BM25.
     */
    search(query, topK = null, minScore = null) {
      if (!ragSettings.enabled && topK === null) return [];
      const k = topK || ragSettings.topK || 4;
      const min = minScore !== null ? minScore : (ragSettings.minScore || 0.35);

      const allChunks = Array.from(inMemoryChunks.values());
      return bm25.search(query, allChunks, k, min);
    },

    /**
     * Formats retrieved knowledge base chunks into a prompt context block.
     */
    formatContext(retrievedChunks) {
      if (!retrievedChunks || retrievedChunks.length === 0) return '';

      const header = `[LOCAL KNOWLEDGE BASE CONTEXT]
The following excerpts were retrieved from the user's local documents and are relevant to their request:`;

      const formattedSnippets = retrievedChunks.map((chunk, idx) => {
        const title = chunk.docTitle || 'Untitled Document';
        return `--- Excerpt ${idx + 1} from "${title}" (Chunk #${chunk.chunkIndex + 1}, Relevance: ${chunk.score}) ---
${chunk.text}`;
      }).join('\n\n');

      const footer = `\nInstructions: Use the relevant local knowledge above to answer the user's question accurately. Mention document names when helpful.`;

      return `${header}\n\n${formattedSnippets}\n${footer}`;
    },

    /**
     * Exports the knowledge base to a JSON string or object for backup.
     */
    exportJSON() {
      const docs = Array.from(inMemoryDocs.values());
      return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        documents: docs,
      }, null, 2);
    },

    /**
     * Imports knowledge base documents from an exported JSON object or string.
     */
    async importJSON(jsonData) {
      await this.init();

      let data = jsonData;
      if (typeof jsonData === 'string') {
        data = JSON.parse(jsonData);
      }

      if (!data || !Array.isArray(data.documents)) {
        throw new Error('Invalid knowledge base format');
      }

      let count = 0;
      for (const d of data.documents) {
        if (d && d.content) {
          await this.addDocument({
            title: d.title || 'Imported Document',
            content: d.content,
            type: d.type || 'text/plain',
          });
          count++;
        }
      }

      notifyUpdate();
      return count;
    },

    // Expose helpers for testing
    _tokenize: tokenize,
    _chunkDocument: chunkDocument,
    _BM25Engine: BM25Engine,
  };

  // ── UI Integration (Browser Only) ─────────────────────────────
  function setupUI() {
    if (typeof document === 'undefined') return;

    const els = {
      ragBtn: document.getElementById('ragBtn'),
      ragOverlay: document.getElementById('ragOverlay'),
      ragClose: document.getElementById('ragClose'),
      ragDoneBtn: document.getElementById('ragDoneBtn'),
      ragIndicatorDot: document.getElementById('ragIndicatorDot'),
      ragStats: document.getElementById('ragStats'),
      ragDocCount: document.getElementById('ragDocCount'),
      ragDocList: document.getElementById('ragDocList'),
      ragEnabledToggle: document.getElementById('ragEnabledToggle'),
      quickRagToggleBtn: document.getElementById('quickRagToggleBtn'),

      // Tabs & Panes
      ragTabUpload: document.getElementById('ragTabUpload'),
      ragTabText: document.getElementById('ragTabText'),
      ragTabTest: document.getElementById('ragTabTest'),
      ragPaneUpload: document.getElementById('ragPaneUpload'),
      ragPaneText: document.getElementById('ragPaneText'),
      ragPaneTest: document.getElementById('ragPaneTest'),

      // Upload
      ragDropzone: document.getElementById('ragDropzone'),
      ragFileInput: document.getElementById('ragFileInput'),

      // Text form
      ragDocTitle: document.getElementById('ragDocTitle'),
      ragDocContent: document.getElementById('ragDocContent'),
      ragAddTextBtn: document.getElementById('ragAddTextBtn'),

      // Test Search
      ragTestQuery: document.getElementById('ragTestQuery'),
      ragTestBtn: document.getElementById('ragTestBtn'),
      ragTestResults: document.getElementById('ragTestResults'),

      // Actions
      ragExportBtn: document.getElementById('ragExportBtn'),
      ragImportInput: document.getElementById('ragImportInput'),
      ragClearBtn: document.getElementById('ragClearBtn'),
    };

    function openModal() {
      if (els.ragOverlay) {
        els.ragOverlay.classList.add('visible');
        renderDocList();
      }
    }

    function closeModal() {
      if (els.ragOverlay) els.ragOverlay.classList.remove('visible');
    }

    function switchTab(tabName) {
      const tabs = [
        { btn: els.ragTabUpload, pane: els.ragPaneUpload, name: 'upload' },
        { btn: els.ragTabText, pane: els.ragPaneText, name: 'text' },
        { btn: els.ragTabTest, pane: els.ragPaneTest, name: 'test' },
      ];

      for (const t of tabs) {
        if (!t.btn || !t.pane) continue;
        const isActive = t.name === tabName;
        t.btn.classList.toggle('active', isActive);
        t.pane.style.display = isActive ? 'block' : 'none';
      }
    }

    function renderDocList() {
      if (!els.ragDocList) return;
      const docs = PrefrontalRAG.getDocuments();

      if (els.ragDocCount) els.ragDocCount.textContent = `${docs.length} document${docs.length === 1 ? '' : 's'}`;

      if (docs.length === 0) {
        els.ragDocList.innerHTML = `<div class="rag-empty-state">No documents in your knowledge base yet. Upload or paste text above to get started.</div>`;
        return;
      }

      els.ragDocList.innerHTML = docs.map(doc => {
        const dateStr = new Date(doc.createdAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        return `
          <div class="rag-doc-item" data-id="${doc.id}">
            <div class="rag-doc-info">
              <div class="rag-doc-title">📄 ${escapeHtml(doc.title)}</div>
              <div class="rag-doc-meta">
                <span>${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}</span> ·
                <span>${formatBytes(doc.size)}</span> ·
                <span>${dateStr}</span>
              </div>
            </div>
            <div class="rag-doc-actions">
              <button class="btn-icon danger rag-delete-doc-btn" data-id="${doc.id}" title="Delete document">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"></path>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Attach delete handlers
      els.ragDocList.querySelectorAll('.rag-delete-doc-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const docId = btn.dataset.id;
          if (docId) {
            await PrefrontalRAG.deleteDocument(docId);
            renderDocList();
          }
        });
      });
    }

    function updateStatsIndicator(state) {
      if (els.ragStats) {
        els.ragStats.textContent = `${state.docCount} document${state.docCount === 1 ? '' : 's'} · ${state.chunkCount} chunk${state.chunkCount === 1 ? '' : 's'} indexed`;
      }
      if (els.ragIndicatorDot) {
        els.ragIndicatorDot.style.display = (state.enabled && state.docCount > 0) ? 'block' : 'none';
      }
      if (els.ragEnabledToggle) {
        els.ragEnabledToggle.checked = state.enabled;
      }
      if (els.quickRagToggleBtn) {
        els.quickRagToggleBtn.classList.toggle('active', state.enabled && state.docCount > 0);
      }
    }

    // Process files from file input or drop
    async function processFiles(files) {
      if (!files || files.length === 0) return;
      let added = 0;

      for (const file of files) {
        try {
          const content = await file.text();
          if (content && content.trim()) {
            await PrefrontalRAG.addDocument({
              title: file.name,
              content,
              type: file.type || 'text/plain',
              size: file.size,
            });
            added++;
          }
        } catch (e) {
          console.error('Error reading file for RAG:', file.name, e);
        }
      }

      if (added > 0) {
        renderDocList();
        if (typeof globalThis.toast === 'function') {
          globalThis.toast(`Added ${added} document${added === 1 ? '' : 's'} to Knowledge Base`, 'success');
        }
      }
    }

    // Modal open / close
    els.ragBtn?.addEventListener('click', openModal);
    els.ragClose?.addEventListener('click', closeModal);
    els.ragDoneBtn?.addEventListener('click', closeModal);
    els.ragOverlay?.addEventListener('click', (e) => {
      if (e.target === els.ragOverlay) closeModal();
    });

    // Quick toggle
    els.quickRagToggleBtn?.addEventListener('click', () => {
      const next = !PrefrontalRAG.isEnabled();
      PrefrontalRAG.setEnabled(next);
      if (typeof globalThis.toast === 'function') {
        globalThis.toast(`Knowledge Base (RAG) ${next ? 'enabled' : 'disabled'}`, 'info');
      }
    });

    els.ragEnabledToggle?.addEventListener('change', (e) => {
      PrefrontalRAG.setEnabled(e.target.checked);
    });

    // Tab buttons
    els.ragTabUpload?.addEventListener('click', () => switchTab('upload'));
    els.ragTabText?.addEventListener('click', () => switchTab('text'));
    els.ragTabTest?.addEventListener('click', () => switchTab('test'));

    // Drag and Drop
    if (els.ragDropzone) {
      els.ragDropzone.addEventListener('click', () => els.ragFileInput?.click());
      els.ragDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        els.ragDropzone.classList.add('dragover');
      });
      els.ragDropzone.addEventListener('dragleave', () => {
        els.ragDropzone.classList.remove('dragover');
      });
      els.ragDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        els.ragDropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          processFiles(e.dataTransfer.files);
        }
      });
    }

    els.ragFileInput?.addEventListener('change', (e) => {
      if (e.target.files) {
        processFiles(e.target.files);
        e.target.value = '';
      }
    });

    // Add Text / Notes form
    els.ragAddTextBtn?.addEventListener('click', async () => {
      const title = els.ragDocTitle?.value.trim() || 'Quick Note';
      const content = els.ragDocContent?.value.trim();
      if (!content) {
        if (typeof globalThis.toast === 'function') globalThis.toast('Please enter note content', 'warn');
        return;
      }

      await PrefrontalRAG.addDocument({ title, content, type: 'text/plain' });
      if (els.ragDocTitle) els.ragDocTitle.value = '';
      if (els.ragDocContent) els.ragDocContent.value = '';
      renderDocList();
      switchTab('upload');
      if (typeof globalThis.toast === 'function') {
        globalThis.toast('Note added to Knowledge Base', 'success');
      }
    });

    // Test Search tab
    function performTestSearch() {
      const query = els.ragTestQuery?.value.trim();
      if (!query || !els.ragTestResults) return;

      const results = PrefrontalRAG.search(query, 5, 0.1);
      if (results.length === 0) {
        els.ragTestResults.innerHTML = `<div class="rag-test-empty">No matching chunks found for "${escapeHtml(query)}"</div>`;
        return;
      }

      els.ragTestResults.innerHTML = results.map(r => `
        <div class="rag-chunk-card">
          <div class="rag-chunk-header">
            <span class="rag-chunk-title">📄 ${escapeHtml(r.docTitle)}</span>
            <span class="rag-chunk-score">Score: ${r.score}</span>
          </div>
          <div class="rag-chunk-text">${escapeHtml(r.text)}</div>
        </div>
      `).join('');
    }

    els.ragTestBtn?.addEventListener('click', performTestSearch);
    els.ragTestQuery?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') performTestSearch();
    });

    // Export
    els.ragExportBtn?.addEventListener('click', () => {
      const json = PrefrontalRAG.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prefrontal-knowledge-base-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import
    els.ragImportInput?.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = await PrefrontalRAG.importJSON(text);
        renderDocList();
        if (typeof globalThis.toast === 'function') {
          globalThis.toast(`Imported ${count} documents into Knowledge Base`, 'success');
        }
      } catch (err) {
        console.error('Import error', err);
        if (typeof globalThis.toast === 'function') {
          globalThis.toast(`Import failed: ${err.message}`, 'error');
        }
      }
      e.target.value = '';
    });

    // Clear All
    els.ragClearBtn?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all documents from your local knowledge base?')) {
        await PrefrontalRAG.clearAll();
        renderDocList();
        if (typeof globalThis.toast === 'function') {
          globalThis.toast('Local Knowledge Base cleared', 'info');
        }
      }
    });

    PrefrontalRAG.onUpdate(updateStatsIndicator);
    PrefrontalRAG.init().then(() => renderDocList());
  }

  // Initialize UI when running in browser
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupUI);
    } else {
      setupUI();
    }
  }

  return PrefrontalRAG;
});
