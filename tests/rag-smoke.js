#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const PrefrontalRAG = require('../rag.js');

async function main() {
  console.log('Running Prefrontal Local Knowledge Base (RAG) smoke tests...');

  // 1. Test tokenization
  const tokens = PrefrontalRAG._tokenize('Hello World! This is a test of BM25 retrieval, with some stop-words.');
  assert(tokens.includes('hello'), 'Token "hello" should be present');
  assert(tokens.includes('world'), 'Token "world" should be present');
  assert(tokens.includes('bm25'), 'Token "bm25" should be present');
  assert(tokens.includes('retrieval'), 'Token "retrieval" should be present');
  assert(!tokens.includes('this'), 'Stop-word "this" should be filtered');
  assert(!tokens.includes('is'), 'Stop-word "is" should be filtered');
  assert(!tokens.includes('a'), 'Stop-word "a" should be filtered');

  // 2. Test document chunking
  const longDoc = `First section of the document explains quantum physics and wave functions.
It has multiple sentences describing particles and light.

Second section explores classical mechanics and Newton's laws of motion.
F equals ma is the fundamental equation for force and acceleration.

Third section covers thermodynamics and entropy in closed systems.
The second law of thermodynamics states that entropy never decreases over time.`;

  const chunks = PrefrontalRAG._chunkDocument(longDoc, 'doc_test_1', 'Physics Notes', {
    chunkSize: 180,
    chunkOverlap: 40,
  });

  assert(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  assert.strictEqual(chunks[0].docId, 'doc_test_1');
  assert.strictEqual(chunks[0].docTitle, 'Physics Notes');
  assert(chunks[0].tokens.length > 0, 'Chunk 0 should have tokens');

  // 3. Test in-memory document ingestion and BM25 search
  await PrefrontalRAG.init();
  await PrefrontalRAG.clearAll();

  await PrefrontalRAG.addDocument({
    title: 'Quantum Physics Guide',
    content: 'Quantum computing leverages superposition and quantum entanglement to process complex computational calculations much faster than classical computers.',
  });

  await PrefrontalRAG.addDocument({
    title: 'Culinary Recipes: Sourdough Bread',
    content: 'To bake artisan sourdough bread, mix flour, water, salt, and active sourdough starter. Let it ferment overnight, then bake at 450 degrees in a Dutch oven.',
  });

  await PrefrontalRAG.addDocument({
    title: 'Docker & Containerization',
    content: 'Containers package application code together with libraries and dependencies so it runs reliably across different computing environments.',
  });

  const docs = PrefrontalRAG.getDocuments();
  assert.strictEqual(docs.length, 3, 'Should have 3 documents stored');

  // Query: Quantum physics
  const quantumResults = PrefrontalRAG.search('quantum entanglement computing', 3, 0.1);
  assert(quantumResults.length > 0, 'Should find quantum results');
  assert.strictEqual(quantumResults[0].docTitle, 'Quantum Physics Guide');
  assert(quantumResults[0].score > 0.5, 'Quantum result score should be high');

  // Query: Bread baking
  const breadResults = PrefrontalRAG.search('sourdough bread flour and baking', 3, 0.1);
  assert(breadResults.length > 0, 'Should find bread baking results');
  assert.strictEqual(breadResults[0].docTitle, 'Culinary Recipes: Sourdough Bread');

  // Query: Containers
  const containerResults = PrefrontalRAG.search('containers package application dependencies', 3, 0.1);
  assert(containerResults.length > 0, 'Should find container results');
  assert.strictEqual(containerResults[0].docTitle, 'Docker & Containerization');

  // 4. Test formatContext
  const context = PrefrontalRAG.formatContext(quantumResults);
  assert(context.includes('[LOCAL KNOWLEDGE BASE CONTEXT]'), 'Should include context header');
  assert(context.includes('Quantum Physics Guide'), 'Should cite document title');
  assert(context.includes('superposition'), 'Should contain snippet text');

  // 5. Test Export and Import
  const exported = PrefrontalRAG.exportJSON();
  const parsed = JSON.parse(exported);
  assert.strictEqual(parsed.documents.length, 3, 'Exported JSON should contain 3 documents');

  await PrefrontalRAG.clearAll();
  assert.strictEqual(PrefrontalRAG.getDocuments().length, 0, 'Documents should be cleared');

  const importedCount = await PrefrontalRAG.importJSON(exported);
  assert.strictEqual(importedCount, 3, 'Should import 3 documents');
  assert.strictEqual(PrefrontalRAG.getDocuments().length, 3, 'Should have 3 restored documents');

  // 6. Test Document Deletion
  const docToDelete = PrefrontalRAG.getDocuments()[0];
  await PrefrontalRAG.deleteDocument(docToDelete.id);
  assert.strictEqual(PrefrontalRAG.getDocuments().length, 2, 'Should have 2 documents after deletion');

  console.log('All Prefrontal Local Knowledge Base (RAG) smoke tests passed!');
}

main().catch(err => {
  console.error(`RAG smoke test failed: ${err.message}\n${err.stack}`);
  process.exit(1);
});
