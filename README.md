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
  assets/
    exam-1/
      q001-front.png
      q001-answer.png
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
- `warningThresholdsSeconds`: optional warning popup times
- `questions`: array of image-based questions
- `promptImage`: main question image
- `figureImage`: optional supporting image
- `answerKeyImage`: image shown after submission
- `correct`: one of `a`, `b`, `c`, or `d`

For manifest-driven exams, use paths that are correct relative to the manifest file, such as `../assets/exam-1/q001-front.png`. Do not use local machine paths.

## Production notes

- `adminResetToken` and `startAccessToken` are client-side gates, not real security.
- `index.html` is marked `noindex` by default for search engines.
- Broken image paths now fail gracefully in the UI instead of showing a broken image icon.
- The sample content lives under `assets/sample-exam/` and `manifests/sample-exam.json`.
- A production template is available at `manifests/exam-template.json`.
- `manifests/exam-1.json` now contains the 50-question Chapter 1 Version 1 subset.
- `manifests/chapter-1-full.json` preserves the full 425-question import.

## Netlify deployment

If you deploy from a repo, `netlify.toml` belongs at the repo root. This project includes:

- `/Users/gallo/projects/Practice_test/netlify.toml`
- `/Users/gallo/projects/Practice_test/practice_test_web_app_v2/_headers`

It is configured to:
- publish `practice_test_web_app_v2`
- avoid aggressive caching on `index.html`, manifests, and JS
- allow long caching on static assets
- set `X-Robots-Tag` noindex on `index.html`

Deployment sequence:

1. Replace the sample tokens and sample exam content.
2. Add your real manifests and assets.
3. Test locally with a real manifest.
4. Deploy to Netlify.
5. Smoke test the live public, admin, and released student links.

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
