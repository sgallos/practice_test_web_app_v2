/**
 * Practice Exam results logger.
 *
 * Deploy this bound to a Google Sheet as a Web App (Execute as: Me,
 * Who has access: Anyone). The deployed /exec URL is what app.js posts to.
 *
 * It creates two tabs on first use if they don't already exist:
 *   Results        - one row per exam submission (summary)
 *   QuestionDetail - one row per question per submission (drill-down)
 *
 * Set SHARED_SECRET below to a random string of your choosing and put the
 * same value in your exam manifest's "resultsSecret" field (or
 * DEFAULT_RESULTS_SECRET in app.js). Requests that don't include a matching
 * secret are rejected, so a stranger who finds the /exec URL can't write
 * fake rows into your sheet.
 *
 * See SETUP.md in this same folder for the full step-by-step deployment
 * walkthrough.
 */

// Set this to a random string only you and your exam manifest(s) know.
// Example: "3f7c9a1e-2b6d-4a10-9c5e-8d21f0b6c774"
var SHARED_SECRET = "";

var RESULTS_SHEET_NAME = "Results";
var DETAIL_SHEET_NAME = "QuestionDetail";
var LOCK_WAIT_MS = 10000;
// app.js only ever generates a crypto.randomUUID() or a "sub_<ts>_<rand>"
// fallback, both of which fit this. Validating against a strict allowlist
// (rather than just apostrophe-prefixing like the other text fields) means
// a submissionId can never itself be a formula, a huge string, or contain
// characters that behave oddly in TextFinder/COUNTIFS lookups.
var SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

var RESULTS_HEADERS = [
  "Timestamp",
  "Submission ID",
  "Student",
  "Exam ID",
  "Exam Title",
  "Score",
  "Total Questions",
  "Score Percent",
  "Total Time (sec)",
];

var DETAIL_HEADERS = [
  "Timestamp",
  "Submission ID",
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

    if (SHARED_SECRET && payload.sharedSecret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "Invalid or missing secret" });
    }

    var submissionId = String(payload.submissionId || "").trim();
    if (!SUBMISSION_ID_PATTERN.test(submissionId)) {
      return jsonResponse({ ok: false, error: "Missing or invalid submissionId" });
    }

    var timestamp = new Date();
    var studentId = sanitizeCell(payload.studentId || "Unknown student");
    var examId = sanitizeCell(payload.examId || "");
    var examTitle = sanitizeCell(payload.examTitle || "");

    // Hold the lock across the duplicate checks AND both appends so two
    // concurrent submissions (or a resubmitted request) can't race each
    // other or double-write the same attempt.
    lock.waitLock(LOCK_WAIT_MS);

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Check each sheet independently rather than treating the submission
    // as one atomic unit. If a previous attempt wrote the summary row but
    // then failed (script error, timeout, page closed) before writing the
    // detail rows, a plain "does the submissionId exist yet" check against
    // just the Results tab would see it as fully handled and skip the
    // retry forever, permanently leaving QuestionDetail incomplete. Instead
    // each retry fills in exactly what's still missing.
    var hasSummary = sheetHasSubmissionId(ss, RESULTS_SHEET_NAME, RESULTS_HEADERS, submissionId);
    var hasDetail = sheetHasSubmissionId(ss, DETAIL_SHEET_NAME, DETAIL_HEADERS, submissionId);

    if (hasSummary && hasDetail) {
      return jsonResponse({ ok: true, duplicate: true });
    }

    if (!hasSummary) {
      appendSummaryRow(ss, timestamp, submissionId, studentId, examId, examTitle, payload);
    }
    if (!hasDetail) {
      appendDetailRows(ss, timestamp, submissionId, studentId, examId, examTitle, payload);
    }

    return jsonResponse({ ok: true, repaired: hasSummary || hasDetail });
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
  return jsonResponse({ ok: true, message: "Practice exam logger is running." });
}

function sheetHasSubmissionId(ss, sheetName, headers, submissionId) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return false;
  var idColumn = headers.indexOf("Submission ID") + 1;
  var searchRange = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1);
  // Range (not Sheet/Spreadsheet) is what exposes createTextFinder() here;
  // it already scopes the search to that range, so there's no separate
  // useSearchRange() call needed (that method doesn't exist on Range).
  var finder = searchRange.createTextFinder(submissionId).matchEntireCell(true);
  return !!finder.findNext();
}

function appendSummaryRow(ss, timestamp, submissionId, studentId, examId, examTitle, payload) {
  var sheet = getOrCreateSheet(ss, RESULTS_SHEET_NAME, RESULTS_HEADERS);
  sheet.appendRow([
    timestamp,
    submissionId,
    studentId,
    examId,
    examTitle,
    numberOrBlank(payload.score),
    numberOrBlank(payload.totalQuestions),
    numberOrBlank(payload.scorePercent),
    numberOrBlank(payload.totalTimeSeconds),
  ]);
}

function appendDetailRows(ss, timestamp, submissionId, studentId, examId, examTitle, payload) {
  var questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (questions.length === 0) return;

  var sheet = getOrCreateSheet(ss, DETAIL_SHEET_NAME, DETAIL_HEADERS);
  var rows = questions.map(function (q) {
    return [
      timestamp,
      submissionId,
      studentId,
      examId,
      examTitle,
      sanitizeCell(q.questionId != null ? String(q.questionId) : ""),
      sanitizeCell(q.selected || ""),
      sanitizeCell(q.correct || ""),
      q.isCorrect ? "TRUE" : "FALSE",
      q.flagged ? "TRUE" : "FALSE",
      numberOrBlank(q.timeSeconds),
    ];
  });

  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, DETAIL_HEADERS.length)
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
// formula. A student typing e.g. "=HYPERLINK(...)" as their name, or an
// attacker posting directly to the endpoint, could otherwise inject a
// formula that runs when you open the sheet. Prefixing with an apostrophe
// forces the cell to render as plain text.
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
