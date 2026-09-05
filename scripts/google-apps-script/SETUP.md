# Google Sheets results backend — setup

This turns a Google Sheet in your Drive into the results backend for the exam
app. Every submission appends rows to it; nothing else needs a server.

## 1. Create the Sheet

1. In your Google Drive, create a new Google Sheet. Name it something like
   `Practice Exam Results`.
2. It's fine to leave it empty. The script creates its own tabs on first use.

## 2. Attach the Apps Script

1. In the Sheet, open **Extensions > Apps Script**.
2. Delete the placeholder `Code.gs` contents and paste in the contents of
   `Code.gs` from this folder.
3. Click the save icon (or Ctrl/Cmd+S).

## 3. Set a shared secret (recommended, but read the caveat)

The deployed URL is technically public — anyone who discovers it could post
fake rows into your sheet without this step.

1. In the Apps Script editor, near the top of `Code.gs`, set:
   `var SHARED_SECRET = "some-long-random-string";`
   (any random string works; a UUID is fine)
2. Save.
3. You'll paste this same value into the app config in step 5.

If you leave `SHARED_SECRET` blank, the endpoint accepts requests from
anyone who has the URL — fine for a quick test, not recommended once you
share the exam link with students.

**Important caveat:** this is obfuscation, not real authentication. The
exam app is a static site, so the secret ends up sitting in plain text in
the manifest JSON (or `app.js`) that ships to every visitor's browser. A
casual passerby who finds the `/exec` URL is stopped; a student who opens
their browser's dev tools or views page source is not. Treat the Sheet
itself as the actual trust boundary — don't put anything in it you
wouldn't want a technically curious student to be able to write a row
into, and periodically glance at the `Results` tab for anything obviously
fabricated (dozens of 100% scores in seconds, nonsense student names,
etc.).

## 4. Deploy it as a Web App

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

## 5. Wire it into the exam app

There is no `exams.js` config for this — set it in one of two places:

- **Per exam (recommended):** add `resultsEndpoint` and `resultsSecret` (if
  you set a `SHARED_SECRET` above) directly to that exam's manifest JSON
  file, alongside its other fields like `title` and `durationMinutes`.
- **Global default:** set `DEFAULT_RESULTS_ENDPOINT` and
  `DEFAULT_RESULTS_SECRET` near the top of `app.js`, which every manifest
  falls back to if it doesn't set its own `resultsEndpoint`.

You can either:
- Set one shared endpoint for all exams (simplest), or
- Set a different `resultsEndpoint` per manifest if you ever want separate
  sheets per chapter.

The name/email field only appears on an exam's start screen once that
exam's `resultsEndpoint` is set — exams without logging configured look and
behave exactly as before.

## 6. Test it

1. Open the deployed URL directly in a browser. You should see:
   `{"ok":true,"message":"Practice exam logger is running."}`
2. Run through a practice exam locally, submit it, then check the Sheet.
   Two tabs should appear: `Results` (one row) and `QuestionDetail` (one row
   per question).

Notes:
- Because the browser posts with `no-cors` (required to avoid CORS
  restrictions on Apps Script Web Apps), the exam app cannot read the
  response. A request that leaves the browser successfully is treated as
  "sent" even if Apps Script itself rejected it (bad secret, invalid
  submissionId, an exception) or the sheet write failed for some other
  reason — the app has no way to tell the difference. This is an accepted
  limitation of the no-cors approach, not a bug: it keeps a logging hiccup
  from ever blocking a student from finishing their exam. If something
  looks wrong (a student says they finished but you don't see their row),
  check the Apps Script **Executions** log (left sidebar in the Apps
  Script editor) for errors from around that time.
- Only a genuine network failure (offline, DNS, connection dropped) is
  visible to the app, and that case does retry automatically the next time
  the results page loads.
- If you ever change the script code after it's deployed, you must create
  a **new version** under Deploy > Manage deployments > Edit > New version,
  or your changes won't go live.
- To share summary stats with someone, share the Sheet itself (Share button,
  top right) — the same way you'd share any Google Sheet.
- Each submission carries a unique `Submission ID`. If a student reloads the
  results page (or the same submission is posted twice for any reason), the
  script recognizes the ID already logged and skips re-writing it. The
  `Results` and `QuestionDetail` tabs are checked independently, so if a
  previous attempt managed to write the summary row but was interrupted
  before writing the per-question detail rows (or vice versa), a retry
  fills in exactly what's missing instead of being treated as a complete
  duplicate and skipped.
- The script briefly locks itself while checking for and writing rows, so
  two students submitting at the same moment can't corrupt each other's
  data.
- Text fields (student name, selected answers, etc.) are stored as literal
  text even if someone types something starting with `=`, `+`, `-`, or `@`,
  so a submission can't inject a spreadsheet formula.

## 7. Summary statistics tab

Add a new tab named `Summary` and paste these formulas in to get an
overview (adjust cell references if you place them elsewhere):

Column letters below match the current sheet layout, which has a
`Submission ID` column right after `Timestamp` in both tabs (`Results`:
A=Timestamp, B=Submission ID, C=Student, D=Exam ID, E=Exam Title, F=Score,
G=Total Questions, H=Score Percent, I=Total Time (sec); `QuestionDetail`:
A=Timestamp, B=Submission ID, C=Student, D=Exam ID, E=Exam Title,
F=Question ID, G=Selected, H=Correct Answer, I=Is Correct, J=Flagged,
K=Time (sec)). If you add or reorder columns later, shift these
accordingly.

```
A1: Overall average score %
B1: =IFERROR(AVERAGE(Results!H2:H), "")

A2: Overall average total time (min)
B2: =IFERROR(AVERAGE(Results!I2:I)/60, "")

A3: Submissions logged
B3: =COUNTA(Results!B2:B)
```

Most-missed questions (paste starting at A6):

```
A6: =QUERY(QuestionDetail!F2:F, "select F, count(F) group by F order by count(F) desc label F 'Question', count(F) 'Attempts'")
```

Then in a column next to it, per-question miss count:

```
D6: =ARRAYFORMULA(IFERROR(COUNTIFS(QuestionDetail!F2:F, A7:A, QuestionDetail!I2:I, "FALSE")))
```

(Adjust the range `A7:A` to match wherever the QUERY output actually lands —
Sheets will complain if the ranges don't line up, just drag it to match.)

Average time per question (paste as its own block):

```
A20: =QUERY(QuestionDetail!F2:K, "select F, avg(K) group by F order by avg(K) desc label F 'Question', avg(K) 'Avg Time (sec)'")
```
