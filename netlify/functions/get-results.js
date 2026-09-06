// netlify/functions/get-results.js
//
// Returns one student's own attempts + question-level results, scoped by
// their access token. The browser never learns the Apps Script URL or the
// shared secret — both come from Netlify environment variables here.
//
// Apps Script itself (see Code.gs's getResultsForToken) only ever returns
// rows whose Token column matches the token in the request, so a student
// can't read another student's results by guessing an exam id or name —
// they'd need the other student's token, which is a random, unguessable
// string generated in their browser and never displayed to anyone else.

const { getConfig, isValidId, jsonResponse } = require("./_shared");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const config = getConfig();
  if (!config) {
    // Fail closed — see the matching comment in submit-results.js.
    return jsonResponse(500, { ok: false, error: "Server not configured" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  if (!isValidId(payload.token)) {
    return jsonResponse(400, { ok: false, error: "Missing or invalid token" });
  }

  try {
    const response = await fetch(config.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getResults", token: payload.token, sharedSecret: config.sharedSecret }),
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
