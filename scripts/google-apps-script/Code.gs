/**
 * Practice Exam results backend (v2 — per-student accounts).
 *
 * Deploy this bound to a Google Sheet as a Web App (Execute as: Me,
 * Who has access: Anyone). This script is NOT called directly by the
 * browser anymore — a Netlify Function proxies every request so the
 * deployed /exec URL and SHARED_SECRET never ship to the student's
 * browser. See SETUP.md in this folder for the full walkthrough.
 *
 * It creates three tabs on first use if they don't already exist:
 *   Students        - one row per known student token
 *   Attempts        - one row per exam submission (summary)
 *   QuestionResults - one row per question per submission (drill-down)
 *
 * Every request (from the Netlify Function) is a POST with a JSON body
 * containing at least { action, sharedSecret }. Two actions are supported:
 *   "submitAttempt" - log a finished exam attempt
 *   "getResults"    - return everything logged for one student's token
 */

// REQUIRED. Set this to a random string (see SETUP.md) before deploying —
// it must match the RESULTS_SHARED_SECRET environment variable on Netlify.
// Since only your Netlify Function calls this URL now (never the
// student's browser), this is a real, non-public secret, not just an
// obfuscation layer. Leaving this blank does NOT open access to everyone;
// every request is rejected until this is set (see doPost below).
var SHARED_SECRET = "";

var STUDENTS_SHEET_NAME = "Students";
var ATTEMPTS_SHEET_NAME = "Attempts";
var QUESTION_RESULTS_SHEET_NAME = "QuestionResults";
var LOCK_WAIT_MS = 10000;

// app.js only ever generates a crypto.randomUUID() or a "sub_<ts>_<rand>" /
// "tok_<ts>_<rand>" fallback, all of which fit this. Validating against a
// strict allowlist means an id can never itself be a formula, an
// unreasonably long string, or contain characters that behave oddly in
// TextFinder lookups.
var ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
var VALID_OPTIONS = ["a", "b", "c", "d"];
// Sanity caps against a hostile or buggy payload. These are generous for
// any real exam (the largest manifests in this app are a few hundred
// questions) while still bounding how much a single request can write.
var MAX_QUESTIONS_PER_ATTEMPT = 500;
var MAX_STRING_LENGTH = 300;
var MAX_TIME_SECONDS_PER_QUESTION = 6 * 60 * 60; // 6 hours
var MAX_TOTAL_TIME_SECONDS = 24 * 60 * 60; // 24 hours

var STUDENTS_HEADERS = ["Token", "Display Name", "First Seen", "Last Seen"];

var ATTEMPTS_HEADERS = [
  "Timestamp",
  "Submission ID",
  "Token",
  "Student",
  "Exam ID",
  "Exam Title",
  "Score",
  "Total Questions",
  "Score Percent",
  "Total Time (sec)",
];

var QUESTION_RESULTS_HEADERS = [
  "Timestamp",
  "Submission ID",
  "Token",
  "Student",
  "Exam ID",
  "Exam Title",
  "Question ID",
  "Selected",
  "Correct Answer",
  "Is Correct",
  "Flagged",
  "Time (sec)",
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "No payload received" });
    }

    var payload = JSON.parse(e.postData.contents);

    // Fail closed: an unset SHARED_SECRET must reject every request, not
    // allow every request. Leaving it blank is a misconfiguration, not an
    // "open by design" mode.
    if (!SHARED_SECRET || payload.sharedSecret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "Invalid or missing secret" });
    }

    var token = String(payload.token || "").trim();
    if (!ID_PATTERN.test(token)) {
      return jsonResponse({ ok: false, error: "Missing or invalid token" });
    }

    lock.waitLock(LOCK_WAIT_MS);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (payload.action === "getResults") {
      return jsonResponse({ ok: true, results: getResultsForToken(ss, token) });
    }

    if (payload.action === "submitAttempt") {
      return submitAttempt(ss, token, payload);
    }

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseErr) {
      // Lock may not have been acquired if we returned early; ignore.
    }
  }
}

// Lets you open the deployed URL directly in a browser to sanity check
// that the deployment itself is live (does not write any data).
function doGet(e) {
  return jsonResponse({ ok: true, message: "Practice exam results backend is running." });
}

function submitAttempt(ss, token, payload) {
  var submissionId = String(payload.submissionId || "").trim();
  if (!ID_PATTERN.test(submissionId)) {
    return jsonResponse({ ok: false, error: "Missing or invalid submissionId" });
  }

  var timestamp = new Date();
  var studentId = sanitizeCell(truncate(payload.studentId || "Unknown student", MAX_STRING_LENGTH));
  var examId = sanitizeCell(truncate(payload.examId || "", MAX_STRING_LENGTH));
  var examTitle = sanitizeCell(truncate(payload.examTitle || "", MAX_STRING_LENGTH));

  // The client-reported score, per-question isCorrect, and totalQuestions
  // are NOT trusted as-is — a malicious or buggy caller could report any
  // score it likes. Instead this recomputes isCorrect from
  // selected === correct for each question (both already present in the
  // payload) and derives score/totalQuestions/scorePercent from that
  // recomputed set, so the summary row can never disagree with its own
  // detail rows.
  //
  // Important limitation this does NOT close: `correct` itself is still
  // client-supplied, not checked against an independent answer key (the
  // app already shows the correct answer to the student during the exam
  // for immediate feedback, so this isn't a secret being protected — it's
  // about internal consistency, not independently verifying the answer
  // key). A sufficiently motivated caller could still fabricate a
  // `selected`/`correct` pair that scores as correct. Treat this sheet as
  // trustworthy against accidental bugs and casual tampering, not as
  // resistant to a determined attacker who wants to fake their own score.
  var questions = normalizeQuestions(payload.questions);
  var score = questions.reduce(function (total, q) {
    return total + (q.isCorrect ? 1 : 0);
  }, 0);
  var totalQuestions = questions.length;
  var scorePercent = totalQuestions ? Math.round((score / totalQuestions) * 1000) / 10 : 0;
  var totalTimeSeconds = clampNumber(payload.totalTimeSeconds, 0, MAX_TOTAL_TIME_SECONDS);

  var summary = {
    score: score,
    totalQuestions: totalQuestions,
    scorePercent: scorePercent,
    totalTimeSeconds: totalTimeSeconds,
  };

  upsertStudent(ss, token, studentId, timestamp);

  // Check each sheet independently rather than treating the submission as
  // one atomic unit. If a previous attempt wrote the summary row but then
  // failed (script error, timeout, connection dropped) before writing the
  // detail rows, a single combined duplicate check would see it as fully
  // handled and skip the retry forever, permanently leaving
  // QuestionResults incomplete. Instead each retry fills in exactly what's
  // still missing.
  var hasAttempt = sheetHasId(ss, ATTEMPTS_SHEET_NAME, ATTEMPTS_HEADERS, "Submission ID", submissionId);
  var hasDetail = sheetHasId(ss, QUESTION_RESULTS_SHEET_NAME, QUESTION_RESULTS_HEADERS, "Submission ID", submissionId);

  if (hasAttempt && hasDetail) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  if (!hasAttempt) {
    appendAttemptRow(ss, timestamp, submissionId, token, studentId, examId, examTitle, summary);
  }
  if (!hasDetail) {
    appendQuestionResultRows(ss, timestamp, submissionId, token, studentId, examId, examTitle, questions);
  }

  return jsonResponse({ ok: true, repaired: hasAttempt || hasDetail });
}

// Validates and recomputes each question entry rather than trusting the
// payload's shape or its isCorrect flag. Anything malformed is dropped
// rather than rejected outright, so one bad entry in a 100-question
// payload doesn't lose the other 99.
function normalizeQuestions(rawQuestions) {
  var list = Array.isArray(rawQuestions) ? rawQuestions.slice(0, MAX_QUESTIONS_PER_ATTEMPT) : [];

  return list
    .filter(function (q) {
      return q && typeof q === "object";
    })
    .map(function (q) {
      var selected = normalizeOption(q.selected);
      var correct = normalizeOption(q.correct);
      return {
        questionId: truncate(q.questionId != null ? String(q.questionId) : "", MAX_STRING_LENGTH),
        selected: selected,
        correct: correct,
        isCorrect: !!selected && selected === correct,
        flagged: !!q.flagged,
        timeSeconds: clampNumber(q.timeSeconds, 0, MAX_TIME_SECONDS_PER_QUESTION),
      };
    });
}

function normalizeOption(value) {
  var normalized = String(value || "").trim().toLowerCase();
  return VALID_OPTIONS.indexOf(normalized) !== -1 ? normalized : "";
}

function clampNumber(value, min, max) {
  var num = Number(value);
  if (!isFinite(num)) return min;
  return Math.min(Math.max(num, min), max);
}

function truncate(value, maxLength) {
  var text = String(value == null ? "" : value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function upsertStudent(ss, token, studentId, timestamp) {
  var sheet = getOrCreateSheet(ss, STUDENTS_SHEET_NAME, STUDENTS_HEADERS);
  var lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    var tokenColumn = STUDENTS_HEADERS.indexOf("Token") + 1;
    var searchRange = sheet.getRange(2, tokenColumn, lastRow - 1, 1);
    var finder = searchRange.createTextFinder(token).matchEntireCell(true);
    var match = finder.findNext();
    if (match) {
      var row = match.getRow();
      sheet.getRange(row, STUDENTS_HEADERS.indexOf("Display Name") + 1).setValue(studentId);
      sheet.getRange(row, STUDENTS_HEADERS.indexOf("Last Seen") + 1).setValue(timestamp);
      return;
    }
  }

  sheet.appendRow([token, studentId, timestamp, timestamp]);
}

function getResultsForToken(ss, token) {
  var attempts = readMatchingRows(ss, ATTEMPTS_SHEET_NAME, ATTEMPTS_HEADERS, "Token", token);
  var questionResults = readMatchingRows(ss, QUESTION_RESULTS_SHEET_NAME, QUESTION_RESULTS_HEADERS, "Token", token);
  return { attempts: attempts, questionResults: questionResults };
}

// Returns every row in `sheetName` whose value in `matchHeader` equals
// `matchValue`, as an array of plain objects keyed by header name. Used to
// scope a student's results to only their own token so one student can't
// read another's data.
function readMatchingRows(ss, sheetName, headers, matchHeader, matchValue) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var matchColumnIndex = headers.indexOf(matchHeader);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  return values
    .filter(function (row) {
      return String(row[matchColumnIndex]) === matchValue;
    })
    .map(function (row) {
      var record = {};
      headers.forEach(function (header, index) {
        var value = row[index];
        record[header] = value instanceof Date ? value.toISOString() : value;
      });
      return record;
    });
}

function sheetHasId(ss, sheetName, headers, headerName, value) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var columnIndex = headers.indexOf(headerName) + 1;
  var searchRange = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1, 1);
  // Range (not Sheet/Spreadsheet) is what exposes createTextFinder() here;
  // it already scopes the search to that range.
  var finder = searchRange.createTextFinder(value).matchEntireCell(true);
  return !!finder.findNext();
}

function appendAttemptRow(ss, timestamp, submissionId, token, studentId, examId, examTitle, summary) {
  var sheet = getOrCreateSheet(ss, ATTEMPTS_SHEET_NAME, ATTEMPTS_HEADERS);
  sheet.appendRow([
    timestamp,
    submissionId,
    token,
    studentId,
    examId,
    examTitle,
    numberOrBlank(summary.score),
    numberOrBlank(summary.totalQuestions),
    numberOrBlank(summary.scorePercent),
    numberOrBlank(summary.totalTimeSeconds),
  ]);
}

function appendQuestionResultRows(ss, timestamp, submissionId, token, studentId, examId, examTitle, questions) {
  if (questions.length === 0) return;

  var sheet = getOrCreateSheet(ss, QUESTION_RESULTS_SHEET_NAME, QUESTION_RESULTS_HEADERS);
  var rows = questions.map(function (q) {
    return [
      timestamp,
      submissionId,
      token,
      studentId,
      examId,
      examTitle,
      sanitizeCell(q.questionId),
      sanitizeCell(q.selected),
      sanitizeCell(q.correct),
      q.isCorrect ? "TRUE" : "FALSE",
      q.flagged ? "TRUE" : "FALSE",
      numberOrBlank(q.timeSeconds),
    ];
  });

  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, QUESTION_RESULTS_HEADERS.length)
    .setValues(rows);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function numberOrBlank(value) {
  return typeof value === "number" && isFinite(value) ? value : "";
}

// Google Sheets treats any cell that starts with =, +, -, or @ as a
// formula. A student typing e.g. "=HYPERLINK(...)" as their name could
// otherwise inject a formula that runs when you open the sheet. Prefixing
// with an apostrophe forces the cell to render as plain text.
function sanitizeCell(value) {
  var text = String(value == null ? "" : value);
  if (/^[=+\-@]/.test(text)) {
    return "'" + text;
  }
  return text;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
