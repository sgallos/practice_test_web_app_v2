// netlify/functions/submit-results.js
//
// The exam app posts exam attempts here — a same-origin path, so nothing
// secret needs to ship to the browser. This function attaches the real
// Google Apps Script URL and shared secret (both kept as Netlify
// environment variables, set in Site settings > Environment variables) and
// forwards the request server-side.
//
// This also fixes a real limitation of the old direct-to-Apps-Script
// design: that used `fetch(..., {mode: "no-cors"})` from the browser,
// which can never read the response, so "the request left the browser"
// and "the sheet was actually updated" were indistinguishable. A
// server-to-server call has no CORS restriction, so this function reads
// the real response from Apps Script and relays it back to the browser —
// meaning the app can now tell a real success from a real failure.
//
// This endpoint is still public — anyone who finds it can POST to it, not
// just the exam app. It cannot verify the caller is a legitimate student
// (there's no per-student login), so it does two things instead: rejects
// obviously malformed/oversized payloads outright, and forwards everything
// else to Code.gs, which independently re-validates and recomputes the
// score/correctness of every submission rather than trusting what it's
// told. See the comment in Code.gs's submitAttempt for the limits of that
// protection.

const {
  getConfig,
  isValidId,
  isReasonableString,
  isReasonableBodySize,
  isValidQuestionsArray,
  MAX_QUESTIONS_PER_ATTEMPT,
  jsonResponse,
} = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const config = getConfig();
  if (!config) {
    // Fail closed: a missing APPS_SCRIPT_URL or RESULTS_SHARED_SECRET is a
    // deployment misconfiguration, not a reason to forward requests with a
    // blank secret and hope Code.gs catches it.
    return jsonResponse(500, { ok: false, error: "Server not configured" });
  }

  // Checked before JSON.parse, and before anything else, so an oversized
  // body never gets parsed or processed at all.
  if (!isReasonableBodySize(event.body)) {
    return jsonResponse(413, { ok: false, error: "Request body too large" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  if (!isValidId(payload.token) || !isValidId(payload.submissionId)) {
    return jsonResponse(400, { ok: false, error: "Missing or invalid token/submissionId" });
  }
  if (payload.studentId != null && !isReasonableString(payload.studentId)) {
    return jsonResponse(400, { ok: false, error: "studentId is too long" });
  }
  if (payload.examId != null && !isReasonableString(payload.examId)) {
    return jsonResponse(400, { ok: false, error: "examId is too long" });
  }
  if (payload.examTitle != null && !isReasonableString(payload.examTitle)) {
    return jsonResponse(400, { ok: false, error: "examTitle is too long" });
  }
  // Validates each question's shape and field sizes, not just that the
  // array itself is short enough — a short array of oversized objects
  // would otherwise slip past a length-only check.
  if (payload.questions != null && !isValidQuestionsArray(payload.questions)) {
    return jsonResponse(400, {
      ok: false,
      error: `questions must be an array of at most ${MAX_QUESTIONS_PER_ATTEMPT} well-formed items`,
    });
  }

  const forwardBody = {
    ...payload,
    // Always force these two — never trust an "action" or secret that
    // might have come from the browser.
    action: "submitAttempt",
    sharedSecret: config.sharedSecret,
  };

  try {
    const response = await fetch(config.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwardBody),
    });
    const text = await response.text();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (err) {
    return jsonResponse(502, { ok: false, error: "Could not reach the results backend" });
  }
};
