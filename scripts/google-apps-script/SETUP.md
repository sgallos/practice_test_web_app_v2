# Results backend — setup

This is a one-time setup you (not the student) do once. After that, every
exam submission is recorded automatically — the student just takes the
exam and enters their name/email like normal.

The pieces:

```
Student's browser → Netlify Function → Google Apps Script → Google Sheet
```

The Google Sheet in your Drive is the permanent record. Apps Script is the
small script that reads/writes it. The Netlify Function is a thin relay
that keeps the Apps Script URL and a shared secret out of the student-facing
app entirely — the student's browser only ever talks to your own site.

## 1. Create the Sheet

1. In your Google Drive, create a new Google Sheet. Name it something like
   `Practice Exam Results`.
2. Leave it empty. The script creates its own tabs (`Students`, `Attempts`,
   `QuestionResults`) on first use.

## 2. Attach the Apps Script

1. In the Sheet, open **Extensions > Apps Script**.
2. Delete the placeholder `Code.gs` contents and paste in the contents of
   `Code.gs` from this folder.
3. Click the save icon (or Ctrl/Cmd+S).

## 3. Set a shared secret

1. In the Apps Script editor, near the top of `Code.gs`, set:
   `var SHARED_SECRET = "some-long-random-string";`
   (any random string works; run `uuidgen` in Terminal for one, or ask
   Claude to generate one)
2. Save.
3. You'll set this same value as a Netlify environment variable in step 5
   — it is never pasted into the app itself, and never belongs in a
   manifest JSON file (manifests ship to every visitor's browser).

**This step is not optional.** Both Code.gs and the Netlify Functions fail
closed: if `SHARED_SECRET` (or the matching `RESULTS_SHARED_SECRET`
environment variable) is left blank, every request is rejected rather than
allowed through. A blank secret disables logging entirely — it does not
mean "open to everyone."

**If a secret ever leaks** (accidentally committed to a manifest, pasted
somewhere public, etc.), generate a new one and update it in both places —
Code.gs and Netlify. Treat the old value as permanently compromised; there
is no way to selectively revoke just the exposure, only to rotate past it.

**Why this is real security now, not just a deterrent:** in the previous
version of this setup, the secret lived in the manifest JSON shipped to
every visitor's browser — anyone who viewed page source could read it. Now
the student's browser never sees this value at all; only your Netlify
Function knows it, and only your Netlify Function is allowed to call the
Apps Script URL. The actual risk that remains is someone gaining access to
your Netlify site's environment variables or your Apps Script project
itself — normal account security (strong password, 2FA) covers that.

## 4. Deploy the Apps Script as a Web App

1. Click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Google will ask you to authorize the script. This is the one manual,
   identity-bound step — click through your own account's consent screen
   (you may see an "unverified app" warning since this is your own private
   script; click **Advanced > Go to (project name)** to proceed).
6. Copy the **Web app URL** it gives you. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## 5. Configure Netlify

The two Netlify Functions (`netlify/functions/submit-results.js` and
`netlify/functions/get-results.js`) read the real endpoint and secret from
environment variables, never from a file in the repo.

1. In the Netlify dashboard, open your site.
2. Go to **Site configuration > Environment variables**.
3. Add:
   - `APPS_SCRIPT_URL` = the `/exec` URL from step 4
   - `RESULTS_SHARED_SECRET` = the secret from step 3
4. Redeploy the site (environment variable changes need a new deploy to
   take effect).

`netlify.toml` at the repo root already points Netlify at the
`netlify/functions` folder — no other Netlify configuration is needed for
this to work. If your site's actual `netlify.toml` lives somewhere else
(for example, one directory up from this repo), copy the `[build]`
`functions = "netlify/functions"` line into that file instead.

## 6. Turn logging on per exam

Add `"resultsEnabled": true` to an exam's manifest JSON (or leave it out —
it defaults to enabled; set it to `false` to turn logging off for a
specific exam). There's nothing else to configure per exam: no URL, no
secret, nothing that touches the student-facing files.

The name/email field, and the "View my past results" link, only appear on
an exam's start screen when `resultsEnabled` is true for that exam.

## 7. Test it

1. Open the deployed Apps Script URL directly in a browser. You should see:
   `{"ok":true,"message":"Practice exam results backend is running."}`
2. Run through a practice exam locally (or on a Netlify deploy preview),
   enter a test name/email, submit it, then check the Sheet. Three tabs
   should appear: `Students` (one row for your test identity), `Attempts`
   (one row for the submission), and `QuestionResults` (one row per
   question).
3. On the exam's start screen, click "View my past results" — it should
   show the attempt you just submitted.
4. To simulate a second student, use a different name/email — the app
   generates a separate access token per distinct name/email typed in the
   same browser (see "How student identity works" below), so this is
   enough to test multiple students without needing separate browsers or
   real accounts.

## How student identity works

Each browser remembers a separate access token per typed name/email (in
`localStorage`, as a small map of identity → token — not just the single
most recent one). The token — not the typed name — is what the backend
uses to decide which rows belong to which student, and it's a long random
string, not something guessable from a name or email. "View my past
results" and the exam submission both use this token, which is why they
always agree on identity within one browser.

Typing a **different** name/email generates a **new**, separate token, so
testing with several fake student identities in the same browser works
correctly — each identity keeps its own history, and switching back to an
identity you used before reuses that same token rather than losing it.
None of them can see each other's results (the Apps Script backend only
returns rows matching the exact token it was given, and there is no way to
look up a token from a name — you'd need to already have it). A browser
remembers up to 25 distinct identities this way; beyond that the
oldest-added one is forgotten (that identity would just start a fresh
history if used again).

If a student clears their browser storage or switches devices, they'll get
a fresh, disconnected identity — there's currently no "log back in with my
email" recovery, since there's no real login system, just a locally-stored
token. That's a reasonable trade-off for a lightweight tool like this, but
worth knowing if a student asks why their history disappeared after
clearing their browser data.

## Notes

- Because the Netlify Function makes a normal server-to-server request to
  Apps Script (no CORS restrictions apply there), it can read the real
  response and relay it back to the browser. The app now gets an honest
  success/failure signal, unlike the old direct-from-browser design, which
  had to use `no-cors` mode and could never confirm whether a write
  actually succeeded.
- A genuine failure — a network drop, or the Function/Apps Script
  returning an error — leaves the attempt in a "pending" state that
  automatically retries the next time that results page loads. The
  backend de-dupes by `submissionId`, so a retry after a send that
  actually succeeded is a harmless no-op.
- If you ever change `Code.gs` after deploying, you must create a **new
  version** under Deploy > Manage deployments > Edit > New version, or your
  changes won't go live. Netlify Functions redeploy automatically whenever
  you push/deploy the site as usual.
- To share results with someone, share the Sheet itself (Share button, top
  right) — the same way you'd share any Google Sheet. Students never get
  Sheet access; they only see their own data through the app's "View my
  past results" link.
- Each submission carries a unique `Submission ID`. If a student reloads
  the results page (or the same submission is posted twice for any
  reason), the script recognizes the ID already logged and skips
  re-writing it. `Attempts` and `QuestionResults` are checked
  independently, so if a previous attempt wrote the summary row but was
  interrupted before writing the per-question detail rows (or vice versa),
  a retry fills in exactly what's missing instead of being treated as a
  complete duplicate and skipped.
- The script briefly locks itself while checking for and writing rows, so
  two students submitting at the same moment can't corrupt each other's
  data.
- Text fields (student name, selected answers, etc.) are stored as literal
  text even if someone types something starting with `=`, `+`, `-`, or `@`,
  so a submission can't inject a spreadsheet formula.
- Both the Netlify Functions and Code.gs reject obviously malformed
  payloads (missing/malformed tokens, oversized strings, more than 500
  questions in one submission) before writing anything.
- **The Sheet's score/correctness numbers are recomputed by Code.gs, not
  trusted from the submission.** A submission reports `selected` and
  `correct` for each question; Code.gs ignores whatever `isCorrect` and
  `score` values it was sent and recomputes both itself from
  `selected === correct`, so the summary row can never disagree with its
  own detail rows, and a buggy or tampered client can't just claim a
  higher score directly.
  - **What this does not close:** `correct` itself still comes from the
    submission, not from an independently-held answer key — the app
    already reveals the correct answer to the student during the exam for
    immediate feedback, so there's no secret being protected here, only
    internal consistency being enforced. A determined user could still
    fabricate a `selected`/`correct` pair that scores as correct. Treat
    this Sheet as reliable against bugs and casual tampering, not as a
    tamper-proof gradebook against a motivated cheater. Closing that
    fully would require the backend to independently fetch and check
    against the real manifest — not implemented in this phase.

## Running the tests

`scripts/tests/` has a small, dependency-free Node test suite that exercises
the actual `Code.gs` and Netlify Function source (not a reimplementation of
their logic), plus the pure token-storage helpers in `app.js`:

```
node scripts/tests/run-all.js
```

or run one file at a time, e.g. `node scripts/tests/test-code-gs.js`.

This is a real regression check — run it after changing any of `Code.gs`,
`netlify/functions/*.js`, or the token-storage helpers in `app.js` — but it
is **not** a substitute for testing against a real Netlify Deploy Preview
with real environment variables and a real Apps Script deployment, since
it mocks the Sheets API and network calls rather than talking to Google.
Do both before merging a change to this backend.

## Deferred (not built yet)

To keep this first version shippable and testable, a few things from the
original brainstorm are intentionally not here yet: live in-progress
tracking while a student is still taking the exam, chapter/topic-level
performance breakdowns (the question manifests don't have a chapter field
yet — that's a content-tagging task, not just code), multi-exam trend
charts, a review queue of missed/flagged questions, and instructor
feedback comments. The data model (`Students`/`Attempts`/`QuestionResults`)
is designed so these can be added later without another schema migration.

## Summary statistics tab

Add a new tab named `Summary` and paste these formulas in to get an
overview (adjust cell references if you place them elsewhere).

Column letters below match the current sheet layout:
`Attempts`: A=Timestamp, B=Submission ID, C=Token, D=Student, E=Exam ID,
F=Exam Title, G=Score, H=Total Questions, I=Score Percent, J=Total Time
(sec). `QuestionResults`: A=Timestamp, B=Submission ID, C=Token,
D=Student, E=Exam ID, F=Exam Title, G=Question ID, H=Selected, I=Correct
Answer, J=Is Correct, K=Flagged, L=Time (sec). If you add or reorder
columns later, shift these accordingly.

```
A1: Overall average score %
B1: =IFERROR(AVERAGE(Attempts!I2:I), "")

A2: Overall average total time (min)
B2: =IFERROR(AVERAGE(Attempts!J2:J)/60, "")

A3: Submissions logged
B3: =COUNTA(Attempts!B2:B)

A4: Distinct students
B4: =COUNTA(UNIQUE(Attempts!C2:C))
```

Most-missed questions (paste starting at A7):

```
A7: =QUERY(QuestionResults!G2:G, "select G, count(G) group by G order by count(G) desc label G 'Question', count(G) 'Attempts'")
```

Then in a column next to it, per-question miss count:

```
D7: =ARRAYFORMULA(IFERROR(COUNTIFS(QuestionResults!G2:G, A8:A, QuestionResults!J2:J, "FALSE")))
```

(Adjust the range `A8:A` to match wherever the QUERY output actually lands
— Sheets will complain if the ranges don't line up, just drag it to
match.)

Average time per question (paste as its own block):

```
A20: =QUERY(QuestionResults!G2:L, "select G, avg(L) group by G order by avg(L) desc label G 'Question', avg(L) 'Avg Time (sec)'")
```
