# Image Practice Exam Player

This app is a lightweight online exam player for image-based practice tests.

It supports:
- opening a test from a link
- timed exam sessions
- answering with A, B, C, or D
- flagging questions to revisit
- final review before submission
- post-exam review of flagged questions
- answer key images after submission
- optional admin-only reset controls hidden from student links
- optional release links so the public student URL can stay locked until you are ready

## Recommended content model

Use separate JSON manifests, one per exam.

Recommended structure:

```text
practice_test_web_app_v2/
  index.html
  app.js
  favicon.svg
  manifests/
    exam-1.json
    exam-2.json
    chapter-2-v1.json
    chapter-4-v1.json
    chapter-4-v2.json
  assets/
    exam-1/
      q001-front.png
      q001-answer.png
    chapter-2/
      front_text__page_001_q001_a.png
      back_ans__page_001_q001_b.png
    chapter-4/
      front_text__page_001_q001_a.png
      back_ans__page_001_q001_a.png
```

Why:
- easier to update a single exam without touching app logic
- easier to debug bad image paths
- easier to duplicate a manifest as a template
- cleaner separation between player code and exam content

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open one of these:

Default Chapter 1 Version 1 exam:

```text
http://localhost:8000/index.html
```

Default Chapter 1 Version 1 admin link:

```text
http://localhost:8000/index.html?admin=3feba3b4-da6e-4ce8-939b-d93d56cfe673
```

## Launch links

Default Chapter 1 Version 1 public link:

```text
index.html
```

Default Chapter 1 Version 1 admin link:

```text
index.html?admin=3feba3b4-da6e-4ce8-939b-d93d56cfe673
```

Default Chapter 1 Version 1 released student link:

```text
index.html?access=02c7de3e-e6d6-4595-8312-d2f071d7c904
```

Default Chapter 1 Version 1 released auto-start link:

```text
index.html?access=02c7de3e-e6d6-4595-8312-d2f071d7c904&start=true
```

Explicit manifest-based exam:

```text
index.html?manifest=https://example.com/manifests/exam-1.json
```

## Admin reset mode

The public student link does not show reset controls.

If you want to see reset buttons yourself, set an `adminResetToken` in the exam config and open the exam with:

```text
index.html?manifest=https://example.com/manifests/exam-1.json&admin=YOUR_RESET_TOKEN
```

The current Chapter 1 admin token is:

```text
3feba3b4-da6e-4ce8-939b-d93d56cfe673
```

Change that value before public deployment if you want a new private admin link.

Important: this is only a convenience gate for a static app. It hides reset controls from normal student links, but it is not strong security because the app is still client-side code.

## Startable release flow

If you set a `startAccessToken`, the public student link opens in a locked state and cannot start the exam.

Use this workflow:

1. Share the normal public exam link if you want students to load the page early.
2. Open your private admin link.
3. Use the admin buttons to copy the released student link when you are ready.
4. Send that released link to the student.

The student can only start from the released link because it includes the `access` token.

Important: in a static app, your admin action cannot remotely change an already-open public link. The practical workaround is sending a second released link when you are ready.

The current Chapter 1 `startAccessToken` is:

```text
02c7de3e-e6d6-4595-8312-d2f071d7c904
```

## Manifest format

The app accepts a JSON manifest with this shape:

```json
{
  "id": "cardio-block-1",
  "title": "Cardio Block 1",
  "description": "Timed image-based practice exam.",
  "version": "1.0.0",
  "durationMinutes": 60,
  "adminResetToken": "replace-this-token",
  "startAccessToken": "replace-this-start-token",
  "resultsEnabled": true,
  "warningThresholdsSeconds": [1800, 600, 120],
  "questions": [
    {
      "id": 1,
      "promptImage": "../assets/cardio-block-1/q001-front.png",
      "figureImage": "../assets/cardio-block-1/q001-figure.png",
      "answerKeyImage": "../assets/cardio-block-1/q001-answer.png",
      "correct": "b"
    }
  ]
}
```

Fields:
- `id`: unique exam id used for saved progress
- `title`: exam title
- `description`: short exam description
- `version`: manifest version label shown in the UI
- `durationMinutes`: total exam time
- `adminResetToken`: optional token that enables reset controls when passed as `?admin=...`
- `startAccessToken`: optional token that keeps the public link locked until the released student link includes `?access=...`
- `resultsEnabled`: optional boolean, defaults to `true`. When true, the start screen shows a name/email field and a "View my past results" link, and every submission is logged to your Google Sheet. Set to `false` to disable logging for a specific exam. There's no URL or secret to set here — see "Results logging" below.
- `warningThresholdsSeconds`: optional warning popup times
- `questions`: array of image-based questions
- `promptImage`: main question image
- `figureImage`: optional supporting image
- `answerKeyImage`: image shown after submission
- `correct`: one of `a`, `b`, `c`, or `d`

For manifest-driven exams, use paths that are correct relative to the manifest file, such as `../assets/exam-1/q001-front.png`. Do not use local machine paths.

## Results logging (Google Sheets as a backend)

This app is static, but exam results still get logged automatically to a
Google Sheet in your Drive, which acts as the permanent results database.
This is a one-time setup you do yourself — students never see or configure
any of it; they just take the exam.

```
Student's browser → Netlify Function → Google Apps Script → Google Sheet
```

How it works:
- The name/email field and a "View my past results" link only appear on
  exams with `resultsEnabled` set (defaults to `true`). If disabled for an
  exam, that exam's start screen and behavior are unaffected by any of
  this.
- The first time a given name/email is used in a browser, the app
  generates a private access token for that identity and remembers it
  locally. That token (not the typed name) is what the backend uses to
  scope reads/writes, so one student can't retrieve another's results.
  Typing a different name/email gets a different token — handy for testing
  with several fake student identities in one browser.
- Per-question time is tracked as the student works and saved into their
  local session as they go, so it survives an accidental reload; time
  spent with the tab in the background isn't counted toward whichever
  question was on screen.
- The browser only ever talks to two same-origin Netlify Functions
  (`/.netlify/functions/submit-results` and `/.netlify/functions/get-results`)
  — never directly to Google. Those functions hold the real Apps Script URL
  and a shared secret as server-side environment variables and relay
  requests to it, which keeps both out of any file that ships to a
  student's browser.
- On submission, the app posts a JSON summary (score, total time, a
  per-question breakdown, and a unique submission ID generated when the
  attempt started). Because the Netlify Function makes a normal
  server-to-server request, the app gets a real, honest success/failure
  signal back — if it can't be confirmed as delivered, the next time that
  results page loads it automatically retries, which is safe because the
  backend recognizes the same submission ID and won't write it twice.
- Apps Script appends rows to three tabs in your Sheet: `Students` (one row
  per known access token), `Attempts` (one row per submission), and
  `QuestionResults` (one row per question per submission, useful for
  spotting which questions students miss most or spend the most time on).
  Writes are de-duplicated and independently repaired per tab (see
  SETUP.md) and locked to avoid collisions between simultaneous
  submissions.
- The Sheet lives in your own Drive. Share it with yourself or anyone else
  the normal Google Sheets way to see full results. Students only ever see
  their own data, through the app's "View my past results" link.

Full setup walkthrough — creating the Sheet, deploying Apps Script, setting
the Netlify environment variables, and how student identity/tokens work:
`scripts/google-apps-script/SETUP.md`. The Apps Script itself lives at
`scripts/google-apps-script/Code.gs`; the Netlify Functions live at
`netlify/functions/submit-results.js` and `netlify/functions/get-results.js`.

Logging is best-effort: if the backend can't be reached, the exam still
runs normally — a logging hiccup never blocks a student from finishing or
seeing their results.

**Deferred for a later pass:** live in-progress tracking while a student is
mid-exam, chapter/topic-level performance breakdowns, multi-exam trend
charts, a review queue of missed/flagged questions, and instructor
feedback comments. The current `Students`/`Attempts`/`QuestionResults`
schema is designed so these can be layered on without another migration.

## Production notes

- `adminResetToken` and `startAccessToken` are client-side gates, not real security.
- `index.html` is marked `noindex` by default for search engines.
- Broken image paths now fail gracefully in the UI instead of showing a broken image icon.
- The sample content lives under `assets/sample-exam/` and `manifests/sample-exam.json`.
- A production template is available at `manifests/exam-template.json`.
- `manifests/exam-1.json` now contains the 50-question Chapter 1 Version 1 subset.
- `manifests/exam-2.json` contains a separate 50-question Chapter 1 Version 2 subset shifted one source question forward from Version 1.
- `manifests/exam-3.json` contains a separate 50-question Chapter 1 Version 3 subset shifted two source questions forward from Version 1.
- `manifests/chapter-1-full.json` preserves the full 425-question import.
- `manifests/gyn-comprehensive-v1.json` through `manifests/gyn-comprehensive-v5.json` split the full Chapter 1 bank into four 100-question exams and one 25-question exam.
- `manifests/chapter-2-v1.json` contains the 48-question Chapter 2 Version 1 subset.
- `manifests/chapter-2-full.json` preserves the full 144-question Chapter 2 import.
- `manifests/chapter-4-v1.json` contains the 43-question Chapter 4 Version 1 subset.
- `manifests/chapter-4-v2.json` contains the 43-question Chapter 4 Version 2 subset.
- `manifests/chapter-4-full.json` preserves the full 130-question Chapter 4 import.
- `manifests/chapter-6-v1.json` contains the 46-question Chapter 6 Version 1 half-bank subset.
- `manifests/chapter-6-v2.json` contains the 46-question Chapter 6 Version 2 half-bank subset.
- `manifests/chapter-6-full.json` preserves the full 92-question Chapter 6 import.
- `manifests/combined-v1.json` contains the 72-question mixed exam with a 42-minute written section for FNA and Lab Operations.
- `manifests/combined-v2.json` contains the second 72-question mixed exam with the same written section and a non-overlapping question set.

## Netlify deployment

If you deploy from a repo, `netlify.toml` belongs at the repo root. This
repo now includes its own `netlify.toml` (at `practice_test_web_app_v2/netlify.toml`)
alongside `_headers`. It's configured to:
- publish `.` (this repo's root)
- serve the two results-logging functions from `netlify/functions`
- (headers/caching are handled separately by `_headers`)

**Important — check which `netlify.toml` your site actually uses.** Before
this results-logging feature existed, this README documented a
`netlify.toml` living one directory up, at `/Users/gallo/projects/Practice_test/netlify.toml`
(outside this repo), configured to publish the `practice_test_web_app_v2`
subdirectory. If your Netlify site's base directory is still set to that
parent folder, Netlify will read *that* file, not the new one added here —
in which case add this line to it yourself:

```toml
[build]
  functions = "practice_test_web_app_v2/netlify/functions"
```

(adjust the path if your publish directory is already `practice_test_web_app_v2`,
in which case `functions = "netlify/functions"` is correct as-is). If your
Netlify site instead deploys straight from this repo (matches the git
remote `practice_test_web_app_v2.git`), the `netlify.toml` now included
here is exactly what you need with no changes.

Deployment sequence:

1. Replace the sample tokens and sample exam content.
2. Add your real manifests and assets.
3. Test locally with a real manifest.
4. If using results logging, follow `scripts/google-apps-script/SETUP.md`
   and set the `APPS_SCRIPT_URL` / `RESULTS_SHARED_SECRET` environment
   variables in Netlify (Site configuration > Environment variables).
5. Deploy to Netlify.
6. Smoke test the live public, admin, and released student links, and (if
   logging is enabled) submit a test exam and confirm rows appear in the
   Sheet.

## Current Chapter 1 Version 1 exam

The current production-ready manifest is:

```text
manifests/exam-1.json
```

Local student URL:

```text
http://localhost:8000/index.html
```

Current `exam-1` admin link:

```text
http://localhost:8000/index.html?admin=3feba3b4-da6e-4ce8-939b-d93d56cfe673
```

Notes:
- The exam contains your selected 50-question subset in the exact order provided.
- The timed duration is set to 75 minutes.
- The imported media for these questions lives in `assets/exam-1/`.
- The full preserved import is available at `manifests/chapter-1-full.json`.
- `exams.js` sets `./manifests/exam-1.json` as the default manifest, so the base app URL opens Chapter 1 Version 1 automatically.

If you want to create another exam later, start from `manifests/exam-template.json`.

## GYN comprehensive exam series

The full 425-question Chapter 1 bank is divided in bank order across five non-overlapping exams:

- Version 1: 100 questions, 150 minutes, source questions 1-100
- Version 2: 100 questions, 150 minutes, source questions 101-201 (source question 112 is absent from the bank)
- Version 3: 100 questions, 150 minutes, source questions 202-301
- Version 4: 100 questions, 150 minutes, source questions 302-401
- Version 5: 25 questions, 37.5 minutes, source questions 402-426

Regenerate the manifests without changing existing access tokens:

```bash
node scripts/generate-gyn-comprehensive-exams.mjs
```

## Current Chapter 1 Version 2 exam

The Version 2 manifest is:

```text
manifests/exam-2.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-2.json
```

Current `exam-2` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-2.json&admin=1b292e72-a68f-4782-a669-111b9558ec9c
```

Current `exam-2` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-2.json&access=34133e69-6fd8-4790-afb9-a76be446204b
```

Current `exam-2` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-2.json&access=34133e69-6fd8-4790-afb9-a76be446204b&start=true
```

Notes:
- The exam contains 50 questions in the same order pattern as Version 1, with each source question id shifted forward by 1.
- The timed duration is set to 75 minutes.
- The imported media for these questions also lives in `assets/exam-1/`.
- `exams.js` still sets `./manifests/exam-1.json` as the default manifest, so the base app URL still opens Chapter 1 Version 1 automatically.

## Current Chapter 1 Version 3 exam

The Version 3 manifest is:

```text
manifests/exam-3.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-3.json
```

Current `exam-3` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-3.json&admin=e7819376-4ce2-4299-ab30-cc2d1a2fa712
```

Current `exam-3` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-3.json&access=6f0b2ab7-8317-4277-b5b5-c1ddf1a3ef45
```

Current `exam-3` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/exam-3.json&access=6f0b2ab7-8317-4277-b5b5-c1ddf1a3ef45&start=true
```

Notes:
- The exam contains 50 questions in the same order pattern as Version 1, with each source question id shifted forward by 2.
- The timed duration is set to 75 minutes.
- The imported media for these questions also lives in `assets/exam-1/`.
- `exams.js` still sets `./manifests/exam-1.json` as the default manifest, so the base app URL still opens Chapter 1 Version 1 automatically.

## Current Chapter 4 Version 1 exam

The Version 1 Chapter 4 manifest is:

```text
manifests/chapter-4-v1.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v1.json
```

Current `chapter-4-v1` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v1.json&admin=75648625-ca74-4861-a27a-d54c051055f0
```

Current `chapter-4-v1` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v1.json&access=b2c8efed-144b-4128-9297-73114c7e2065
```

Current `chapter-4-v1` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v1.json&access=b2c8efed-144b-4128-9297-73114c7e2065&start=true
```

Notes:
- The exam contains 43 questions selected by interval: 1, 4, 7, through 127.
- The timed duration is set to 64.5 minutes, which is 1 minute 30 seconds per question.
- The imported media for these questions lives in `assets/chapter-4/`.
- The full preserved Chapter 4 import is available at `manifests/chapter-4-full.json`.
- `exams.js` still sets `./manifests/exam-1.json` as the default manifest, so the base app URL still opens Chapter 1 Version 1 automatically.

## Current Chapter 4 Version 2 exam

The Version 2 Chapter 4 manifest is:

```text
manifests/chapter-4-v2.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v2.json
```

Current `chapter-4-v2` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v2.json&admin=c97211e1-6945-4c57-b2c1-a3482748906e
```

Current `chapter-4-v2` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v2.json&access=2a2b2345-5605-4ac9-a9af-657bd580b72e
```

Current `chapter-4-v2` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-4-v2.json&access=2a2b2345-5605-4ac9-a9af-657bd580b72e&start=true
```

Notes:
- The exam contains 43 questions selected by interval: 2, 5, 8, through 128.
- The timed duration is set to 64.5 minutes, which is 1 minute 30 seconds per question.
- The imported media for these questions lives in `assets/chapter-4/`.
- The full preserved Chapter 4 import is available at `manifests/chapter-4-full.json`.

## Current Chapter 2 Version 1 exam

The Version 1 Chapter 2 manifest is:

```text
manifests/chapter-2-v1.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-2-v1.json
```

Current `chapter-2-v1` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-2-v1.json&admin=806bcb96-1175-4338-94a2-9bc0a47560a1
```

Current `chapter-2-v1` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-2-v1.json&access=c802bdd4-d9a6-450b-bd5c-f63b17bdf82e
```

Current `chapter-2-v1` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-2-v1.json&access=c802bdd4-d9a6-450b-bd5c-f63b17bdf82e&start=true
```

Notes:
- The exam contains 48 questions selected by interval: 1, 4, 7, through 142.
- The timed duration is set to 72 minutes, which is 1 minute 30 seconds per question.
- The imported media for these questions lives in `assets/chapter-2/`.
- The full preserved Chapter 2 import is available at `manifests/chapter-2-full.json`.

## Current Chapter 6 Version 1 exam

The Version 1 Chapter 6 manifest is:

```text
manifests/chapter-6-v1.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v1.json
```

Current `chapter-6-v1` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v1.json&admin=3ebece13-a83c-4a5b-9125-3a3c1e93554d
```

Current `chapter-6-v1` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v1.json&access=d89ca91a-34c2-4b48-9322-ec9a4238757a
```

Current `chapter-6-v1` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v1.json&access=d89ca91a-34c2-4b48-9322-ec9a4238757a&start=true
```

Notes:
- The exam contains 46 questions selected by every other source question: 1, 3, 5, through 91.
- The timed duration is set to 69 minutes, which is 1 minute 30 seconds per question.
- The imported media for these questions lives in `assets/chapter-6/`.
- The full preserved Chapter 6 import is available at `manifests/chapter-6-full.json`.

## Current Chapter 6 Version 2 exam

The Version 2 Chapter 6 manifest is:

```text
manifests/chapter-6-v2.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v2.json
```

Current `chapter-6-v2` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v2.json&admin=97c8805d-d83b-4266-88ce-3be48d1f011b
```

Current `chapter-6-v2` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v2.json&access=e84a2eff-b102-4128-bc0c-61a0abf8c53a
```

Current `chapter-6-v2` released auto-start link:

```text
http://localhost:8000/index.html?manifest=./manifests/chapter-6-v2.json&access=e84a2eff-b102-4128-bc0c-61a0abf8c53a&start=true
```

Notes:
- The exam contains 46 questions selected by every other source question: 2, 4, 6, through 92.
- The timed duration is set to 69 minutes, which is 1 minute 30 seconds per question.
- The imported media for these questions lives in `assets/chapter-6/`.
- The full preserved Chapter 6 import is available at `manifests/chapter-6-full.json`.

## Current Mixed Exam Version 1

The mixed exam manifest is:

```text
manifests/combined-v1.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v1.json
```

Current `combined-v1` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v1.json&admin=081ae70b-0e60-4076-a341-0376ec484108
```

Current `combined-v1` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v1.json&access=f9989e34-dd12-4d3c-8dc2-c8cd44768f42
```

Notes:
- The online section contains 72 questions: 42 GYN, 10 Respiratory, 10 Urinary, and 10 Fluids.
- The online image-question timer is 108 minutes.
- After the image questions, the app switches into a 42-minute written section labeled `FNA and Lab Operations`.
- The total timed sitting is 150 minutes.

## Current Mixed Exam Version 2

The mixed exam manifest is:

```text
manifests/combined-v2.json
```

Local student URL:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v2.json
```

Current `combined-v2` admin link:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v2.json&admin=0cdf2c6c-148c-4123-8681-6b6cc8e0ef3d
```

Current `combined-v2` released student link:

```text
http://localhost:8000/index.html?manifest=./manifests/combined-v2.json&access=9762191b-63d3-4386-b664-fd5cc4f3bcee
```

Notes:
- The online section contains 72 questions: 42 GYN, 10 Respiratory, 10 Urinary, and 10 Fluids.
- The online image-question timer is 108 minutes.
- After the image questions, the app switches into a 42-minute written section labeled `FNA and Lab Operations`.
- The total timed sitting is 150 minutes.
