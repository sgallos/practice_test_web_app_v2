// scripts/tests/test-student-token-storage.js
//
// app.js can't be `require()`d directly — it's written for the browser and
// touches the global `React` at module load time. Instead, this extracts
// the small, pure token-storage helpers (loadOrCreateStudentToken,
// loadStudentTokenMap, saveStudentTokenMap, generateId, plus the constants
// they close over) straight out of the real app.js source between two
// stable markers, and evaluates just that slice against a fake
// localStorage. If those markers ever stop matching (the functions get
// renamed or moved), this fails loudly instead of silently testing nothing.
//
// This does NOT test the React effect that locks a token into
// session.token when an attempt starts, or the "view past results doesn't
// leak into the next attempt's identity" fix in app.js — those live inside
// React effects and would need a DOM + React test renderer to exercise
// properly. That gap is intentional for now; this covers the pure
// token-map logic underneath them.
//
// Run with: node scripts/tests/test-student-token-storage.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const APP_JS_PATH = path.join(__dirname, "..", "..", "app.js");
const source = fs.readFileSync(APP_JS_PATH, "utf8");

const startMarker = "function generateId(prefix) {";
const endMarker = "function loadSession(storageKey, exam, autoStart) {";
const startIndex = source.indexOf(startMarker);
const endIndex = source.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  console.log("FAIL: could not locate the token-storage helper functions in app.js — markers may be stale");
  process.exitCode = 1;
  return;
}

const snippet = source.slice(startIndex, endIndex);
const STUDENT_TOKEN_STORAGE_KEY = "practice-test-student-token";

let passed = 0;
let failed = 0;

function test(name, fn) {
  // Fresh fake localStorage and a fresh eval per test so tests don't leak
  // state into each other.
  global.localStorage = (() => {
    let store = {};
    return {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
  })();
  global.crypto = undefined; // exercise the fallback id generator deterministically enough to inspect

  const sandbox = {};
  // eslint-disable-next-line no-eval
  eval(snippet + "\nsandbox.loadOrCreateStudentToken = loadOrCreateStudentToken;\nsandbox.loadStudentTokenMap = loadStudentTokenMap;");

  try {
    fn(sandbox);
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL: ${name}`);
    console.log(`      ${err.message}`);
    failed += 1;
  }
}

test("the same identity gets the same token across calls", (t) => {
  const token1 = t.loadOrCreateStudentToken("alice@example.com");
  const token2 = t.loadOrCreateStudentToken("alice@example.com");
  assert.strictEqual(token1, token2);
});

test("different identities get different tokens", (t) => {
  const tokenA = t.loadOrCreateStudentToken("alice@example.com");
  const tokenB = t.loadOrCreateStudentToken("bob@example.com");
  assert.notStrictEqual(tokenA, tokenB);
});

test("switching identities and back does not lose the earlier identity's token", (t) => {
  const tokenA1 = t.loadOrCreateStudentToken("alice@example.com");
  t.loadOrCreateStudentToken("bob@example.com");
  const tokenA2 = t.loadOrCreateStudentToken("alice@example.com");
  assert.strictEqual(tokenA1, tokenA2, "re-selecting alice should reuse her original token, not generate a new one");
});

test("the stored map keeps every distinct identity, not just the most recent", (t) => {
  const tokenA = t.loadOrCreateStudentToken("alice@example.com");
  const tokenB = t.loadOrCreateStudentToken("bob@example.com");
  const map = t.loadStudentTokenMap();
  assert.strictEqual(Object.keys(map).length, 2);
  assert.strictEqual(map["alice@example.com"], tokenA);
  assert.strictEqual(map["bob@example.com"], tokenB);
});

test("the identity map is capped so it can't grow without bound", (t) => {
  for (let i = 0; i < 30; i++) {
    t.loadOrCreateStudentToken(`student${i}@example.com`);
  }
  const map = t.loadStudentTokenMap();
  assert.ok(Object.keys(map).length <= 25, `expected at most 25 stored identities, got ${Object.keys(map).length}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
