// scripts/tests/test-code-gs.js
//
// Exercises the ACTUAL scripts/google-apps-script/Code.gs source (via
// Node's vm module against small in-memory fakes of SpreadsheetApp /
// LockService / ContentService) rather than a reimplementation of its
// logic. This catches real bugs in Code.gs itself — including, during
// development, a genuine `TextFinder` API misuse that a reimplementation
// would never have surfaced.
//
// Run with: node scripts/tests/test-code-gs.js
// Exits non-zero if any assertion fails, so it can be wired into CI later.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const CODE_GS_PATH = path.join(__dirname, "..", "google-apps-script", "Code.gs");
const source = fs.readFileSync(CODE_GS_PATH, "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL: ${name}`);
    console.log(`      ${err.message}`);
    failed += 1;
  }
}

// --- Minimal fakes of the Apps Script Sheets API surface Code.gs uses ---

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows || 1;
    this.numCols = numCols || 1;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(this.sheet.data[this.row - 1 + r][this.col - 1 + c]);
      out.push(rowArr);
    }
    return out;
  }
  setValues(values) {
    values.forEach((rowArr, r) => {
      const targetRowIndex = this.row - 1 + r;
      if (!this.sheet.data[targetRowIndex]) this.sheet.data[targetRowIndex] = [];
      rowArr.forEach((val, c) => {
        this.sheet.data[targetRowIndex][this.col - 1 + c] = val;
      });
    });
  }
  setValue(v) {
    this.sheet.data[this.row - 1][this.col - 1] = v;
  }
  createTextFinder(text) {
    return new FakeTextFinder(this, text);
  }
}

class FakeTextFinder {
  constructor(range, text) {
    this.searchRange = range;
    this.text = text;
    this.matchEntire = false;
  }
  matchEntireCell(v) {
    this.matchEntire = v;
    return this;
  }
  useSearchRange(r) {
    this.searchRange = r;
    return this;
  }
  findNext() {
    const r = this.searchRange;
    for (let i = 0; i < r.numRows; i++) {
      const val = r.sheet.data[r.row - 1 + i][r.col - 1];
      const matches = this.matchEntire ? String(val) === this.text : String(val).includes(this.text);
      if (matches) return { getRow: () => r.row + i };
    }
    return null;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
  }
  appendRow(rowArr) {
    this.data.push(rowArr.slice());
  }
  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getLastRow() {
    return this.data.length;
  }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = {};
  }
  getSheetByName(name) {
    return this.sheets[name] || null;
  }
  insertSheet(name) {
    const s = new FakeSheet(name);
    this.sheets[name] = s;
    return s;
  }
}

function buildSandbox(sharedSecret) {
  const ss = new FakeSpreadsheet();
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    isFinite,
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput(text) {
        const obj = { text, setMimeType: () => obj };
        return obj;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  sandbox.SHARED_SECRET = sharedSecret;
  return { sandbox, ss };
}

function post(sandbox, payload) {
  const result = sandbox.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(result.text);
}

function rowAsRecord(sheet, rowIndex) {
  const headers = sheet.data[0];
  const row = sheet.data[rowIndex];
  const record = {};
  headers.forEach((h, i) => (record[h] = row[i]));
  return record;
}

// --- Tests ---

test("fails closed when SHARED_SECRET is blank, regardless of what's sent", () => {
  const { sandbox } = buildSandbox("");
  const res = post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "",
    token: "tok_12345678",
    submissionId: "sub_12345678",
  });
  assert.strictEqual(res.ok, false);
});

test("rejects a wrong secret and accepts the right one", () => {
  const { sandbox } = buildSandbox("real-secret");
  let res = post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "wrong",
    token: "tok_12345678",
    submissionId: "sub_12345678",
  });
  assert.strictEqual(res.ok, false);

  res = post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "real-secret",
    token: "tok_12345678",
    submissionId: "sub_12345678",
    studentId: "jordan",
    examId: "e1",
    examTitle: "Exam 1",
    questions: [],
  });
  assert.strictEqual(res.ok, true);
});

test("recomputes score/isCorrect from selected===correct instead of trusting the client", () => {
  const { sandbox, ss } = buildSandbox("s3cret");
  post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "s3cret",
    token: "tok_abcdefgh",
    submissionId: "sub_abcdefgh",
    studentId: "cheater@example.com",
    examId: "exam-1",
    examTitle: "Exam One",
    score: 999, // lie
    scorePercent: 100, // lie
    totalTimeSeconds: -50, // out of range
    questions: [
      { questionId: 1, selected: "a", correct: "a", isCorrect: false, flagged: false, timeSeconds: 30 }, // truth: correct despite isCorrect lie
      { questionId: 2, selected: "b", correct: "c", isCorrect: true, flagged: true, timeSeconds: 99999999 }, // truth: wrong despite isCorrect lie; time way out of range
    ],
  });

  const attempt = rowAsRecord(ss.getSheetByName("Attempts"), 1);
  assert.strictEqual(attempt["Score"], 1, "score should be recomputed truth (1), not the claimed 999");
  assert.strictEqual(attempt["Score Percent"], 50);
  assert.strictEqual(attempt["Total Time (sec)"], 0, "negative time should clamp to 0");

  const detail = ss.getSheetByName("QuestionResults");
  const q1 = rowAsRecord(detail, 1);
  const q2 = rowAsRecord(detail, 2);
  assert.strictEqual(q1["Is Correct"], "TRUE");
  assert.strictEqual(q2["Is Correct"], "FALSE");
  assert.strictEqual(q2["Time (sec)"], 21600, "per-question time should clamp to the 6-hour cap");
});

test("caps an oversized questions array instead of writing all of it", () => {
  const { sandbox, ss } = buildSandbox("s3cret");
  const bigQuestions = Array.from({ length: 600 }, (_, i) => ({
    questionId: i,
    selected: "a",
    correct: "a",
    isCorrect: true,
    flagged: false,
    timeSeconds: 1,
  }));
  post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "s3cret",
    token: "tok_bignum1",
    submissionId: "sub_bignum1",
    studentId: "x",
    examId: "e",
    examTitle: "E",
    questions: bigQuestions,
  });
  const detail = ss.getSheetByName("QuestionResults");
  assert.strictEqual(detail.data.length - 1, 500);
});

test("a retry after a partial write fills in only what's missing (independent repair)", () => {
  const { sandbox, ss } = buildSandbox("s3cret");
  const ATTEMPTS_HEADERS_ROW = ["Timestamp", "Submission ID", "Token", "Student", "Exam ID", "Exam Title", "Score", "Total Questions", "Score Percent", "Total Time (sec)"];
  // Simulate a prior run that wrote the summary row but crashed before
  // writing detail rows, by seeding the Attempts sheet directly.
  const attemptsSheet = ss.insertSheet("Attempts");
  attemptsSheet.appendRow(ATTEMPTS_HEADERS_ROW);
  attemptsSheet.appendRow(["2024-01-01T00:00:00.000Z", "sub_partial1", "tok_partial1", "s", "e", "E", 1, 1, 100, 60]);

  const res = post(sandbox, {
    action: "submitAttempt",
    sharedSecret: "s3cret",
    token: "tok_partial1",
    submissionId: "sub_partial1",
    studentId: "s",
    examId: "e",
    examTitle: "E",
    questions: [{ questionId: 1, selected: "a", correct: "a", isCorrect: true, flagged: false, timeSeconds: 10 }],
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.repaired, true);
  assert.strictEqual(attemptsSheet.data.length - 1, 1, "should not have written a second Attempts row");
  const detail = ss.getSheetByName("QuestionResults");
  assert.strictEqual(detail.data.length - 1, 1, "should have filled in the missing detail row");
});

test("getResults only returns rows matching the exact token given", () => {
  const { sandbox } = buildSandbox("s3cret");
  post(sandbox, { action: "submitAttempt", sharedSecret: "s3cret", token: "tok_aaaaaaaa", submissionId: "sub_aaaaaaaa", studentId: "a", examId: "e", examTitle: "E", questions: [] });
  post(sandbox, { action: "submitAttempt", sharedSecret: "s3cret", token: "tok_bbbbbbbb", submissionId: "sub_bbbbbbbb", studentId: "b", examId: "e", examTitle: "E", questions: [] });

  const resA = post(sandbox, { action: "getResults", sharedSecret: "s3cret", token: "tok_aaaaaaaa" });
  assert.strictEqual(resA.results.attempts.length, 1);
  assert.strictEqual(resA.results.attempts[0].Token, "tok_aaaaaaaa");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
