// scripts/tests/test-netlify-functions.js
//
// Exercises the actual netlify/functions/*.js handlers with a mocked
// global fetch, so no real network call or live Apps Script deployment is
// needed. This is NOT a substitute for a real Netlify Deploy Preview test
// with real environment variables and a real Apps Script deployment (see
// scripts/google-apps-script/SETUP.md) — it only proves the request
// validation, fail-closed behavior, and secret-forwarding logic in these
// two functions is correct in isolation.
//
// Run with: node scripts/tests/test-netlify-functions.js
// Exits non-zero if any assertion fails, so it can be wired into CI later.

const assert = require("assert");
const path = require("path");

const SUBMIT_PATH = path.join(__dirname, "..", "..", "netlify", "functions", "submit-results.js");
const GET_RESULTS_PATH = path.join(__dirname, "..", "..", "netlify", "functions", "get-results.js");
const SHARED_PATH = path.join(__dirname, "..", "..", "netlify", "functions", "_shared.js");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL: ${name}`);
    console.log(`      ${err.message}`);
    failed += 1;
  }
}

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function reloadAll() {
  delete require.cache[require.resolve(SHARED_PATH)];
  return {
    submit: freshRequire(SUBMIT_PATH),
    getResults: freshRequire(GET_RESULTS_PATH),
  };
}

function setEnv(url, secret) {
  if (url == null) delete process.env.APPS_SCRIPT_URL;
  else process.env.APPS_SCRIPT_URL = url;
  if (secret == null) delete process.env.RESULTS_SHARED_SECRET;
  else process.env.RESULTS_SHARED_SECRET = secret;
}

let fetchCalls;
function mockFetch(responseBody) {
  fetchCalls = [];
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { text: async () => JSON.stringify(responseBody != null ? responseBody : { ok: true }) };
  };
}

function throwingFetch() {
  fetchCalls = [];
  global.fetch = async () => {
    throw new Error("network down");
  };
}

(async () => {
  await test("submit-results fails closed when env vars are missing (never calls fetch)", async () => {
    setEnv(null, null);
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({ httpMethod: "POST", body: JSON.stringify({ token: "tok_12345678", submissionId: "sub_12345678" }) });
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results rejects non-POST methods", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({ httpMethod: "GET", body: "{}" });
    assert.strictEqual(res.statusCode, 405);
  });

  await test("submit-results rejects a malformed token/submissionId before calling fetch", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({ httpMethod: "POST", body: JSON.stringify({ token: "short", submissionId: "sub_12345678" }) });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results rejects an oversized questions array before calling fetch", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const bigQuestions = Array.from({ length: 501 }, () => ({ selected: "a", correct: "a" }));
    const res = await submit.handler({
      httpMethod: "POST",
      body: JSON.stringify({ token: "tok_12345678", submissionId: "sub_12345678", questions: bigQuestions }),
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results rejects a question with an oversized field before calling fetch", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({
      httpMethod: "POST",
      body: JSON.stringify({
        token: "tok_12345678",
        submissionId: "sub_12345678",
        questions: [{ selected: "a".repeat(1000), correct: "a" }],
      }),
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results rejects an out-of-range per-question timeSeconds before calling fetch", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({
      httpMethod: "POST",
      body: JSON.stringify({
        token: "tok_12345678",
        submissionId: "sub_12345678",
        questions: [{ selected: "a", correct: "a", timeSeconds: 999999999 }],
      }),
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results rejects an oversized request body before parsing it", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { submit } = reloadAll();
    const hugeBody = JSON.stringify({ token: "tok_12345678", submissionId: "sub_12345678", padding: "x".repeat(300 * 1024) });
    const res = await submit.handler({ httpMethod: "POST", body: hugeBody });
    assert.strictEqual(res.statusCode, 413);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("submit-results forwards a valid payload with the server-side secret, ignoring any client-sent action/secret", async () => {
    setEnv("http://localhost:9999", "real-secret");
    mockFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({
      httpMethod: "POST",
      body: JSON.stringify({
        token: "tok_12345678",
        submissionId: "sub_12345678",
        studentId: "a",
        examId: "e",
        examTitle: "E",
        questions: [],
        action: "somethingElse",
        sharedSecret: "attacker-supplied",
      }),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(fetchCalls.length, 1);
    const forwarded = JSON.parse(fetchCalls[0].opts.body);
    assert.strictEqual(forwarded.action, "submitAttempt");
    assert.strictEqual(forwarded.sharedSecret, "real-secret");
  });

  await test("submit-results returns 502 (not a crash) when the backend is unreachable", async () => {
    setEnv("http://localhost:9999", "secret");
    throwingFetch();
    const { submit } = reloadAll();
    const res = await submit.handler({
      httpMethod: "POST",
      body: JSON.stringify({ token: "tok_12345678", submissionId: "sub_12345678", questions: [] }),
    });
    assert.strictEqual(res.statusCode, 502);
  });

  await test("get-results fails closed when env vars are missing (never calls fetch)", async () => {
    setEnv(null, null);
    mockFetch();
    const { getResults } = reloadAll();
    const res = await getResults.handler({ httpMethod: "POST", body: JSON.stringify({ token: "tok_12345678" }) });
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("get-results rejects a missing/invalid token before calling fetch", async () => {
    setEnv("http://localhost:9999", "secret");
    mockFetch();
    const { getResults } = reloadAll();
    const res = await getResults.handler({ httpMethod: "POST", body: JSON.stringify({}) });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(fetchCalls.length, 0);
  });

  await test("get-results scopes the forwarded request to only the given token", async () => {
    setEnv("http://localhost:9999", "real-secret");
    mockFetch();
    const { getResults } = reloadAll();
    const res = await getResults.handler({ httpMethod: "POST", body: JSON.stringify({ token: "tok_12345678" }) });
    assert.strictEqual(res.statusCode, 200);
    const forwarded = JSON.parse(fetchCalls[0].opts.body);
    assert.strictEqual(forwarded.action, "getResults");
    assert.strictEqual(forwarded.token, "tok_12345678");
    assert.strictEqual(forwarded.sharedSecret, "real-secret");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
