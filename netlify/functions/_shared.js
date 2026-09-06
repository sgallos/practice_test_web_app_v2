// netlify/functions/_shared.js
//
// Shared helpers for the results-logging Netlify Functions. Code.gs is
// still the final authority (it's the only thing that actually writes to
// the Sheet, and re-validates/recomputes everything itself), but rejecting
// obviously-bad requests here means junk never even reaches Google Apps
// Script, which has its own daily execution quota worth protecting.

const ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const MAX_STRING_LENGTH = 300;
const MAX_QUESTIONS_PER_ATTEMPT = 500;
// Real question fields are tiny (a single letter, a short id) — this is
// generous headroom, not a realistic size, so anything hitting it is
// already suspect.
const MAX_QUESTION_FIELD_LENGTH = 60;
const MAX_TIME_SECONDS_PER_QUESTION = 6 * 60 * 60; // 6 hours, mirrors Code.gs
// Caps the whole request body, checked before it's even JSON.parsed. 500
// questions at generous per-field sizes is well under 100KB; this leaves
// a wide margin while still bounding how much a single public POST can
// make this function (and then Apps Script) process.
const MAX_BODY_BYTES = 256 * 1024;

// Fail closed: returns null (meaning "refuse the request") if either the
// endpoint or the secret is missing, rather than silently forwarding with
// an empty secret and relying entirely on Code.gs to reject it.
function getConfig() {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  const sharedSecret = process.env.RESULTS_SHARED_SECRET;
  if (!appsScriptUrl || !sharedSecret) return null;
  return { appsScriptUrl, sharedSecret };
}

function isValidId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isReasonableString(value, maxLength) {
  return typeof value === "string" && value.length <= (maxLength || MAX_STRING_LENGTH);
}

// Checked before JSON.parse so an oversized request is rejected without
// ever paying the cost of parsing it.
function isReasonableBodySize(rawBody) {
  return typeof rawBody === "string" && Buffer.byteLength(rawBody, "utf8") <= MAX_BODY_BYTES;
}

// Validates shape and bounds per question — not just that the array
// itself isn't too long. A caller could otherwise send a short array of
// enormous objects and slip past a length-only check.
function isValidQuestionsArray(questions) {
  if (!Array.isArray(questions) || questions.length > MAX_QUESTIONS_PER_ATTEMPT) return false;

  return questions.every((q) => {
    if (!q || typeof q !== "object" || Array.isArray(q)) return false;
    if (q.questionId != null && String(q.questionId).length > MAX_QUESTION_FIELD_LENGTH) return false;
    if (q.selected != null && String(q.selected).length > MAX_QUESTION_FIELD_LENGTH) return false;
    if (q.correct != null && String(q.correct).length > MAX_QUESTION_FIELD_LENGTH) return false;
    if (q.timeSeconds != null) {
      const seconds = Number(q.timeSeconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_TIME_SECONDS_PER_QUESTION) return false;
    }
    return true;
  });
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

module.exports = {
  ID_PATTERN,
  MAX_STRING_LENGTH,
  MAX_QUESTIONS_PER_ATTEMPT,
  MAX_QUESTION_FIELD_LENGTH,
  MAX_TIME_SECONDS_PER_QUESTION,
  MAX_BODY_BYTES,
  getConfig,
  isValidId,
  isReasonableString,
  isReasonableBodySize,
  isValidQuestionsArray,
  jsonResponse,
};
