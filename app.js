const { useEffect, useMemo, useState } = React;

const DEFAULT_EXAM_MINUTES = 60;
const DEFAULT_WARNING_THRESHOLDS = [30 * 60, 10 * 60, 5 * 60];
const EXAM_QUERY_PARAM = "exam";
const MANIFEST_QUERY_PARAM = "manifest";
const AUTO_START_PARAM = "start";
const ADMIN_QUERY_PARAM = "admin";
const ACCESS_QUERY_PARAM = "access";
const VALID_OPTIONS = ["a", "b", "c", "d"];

function getSearchParams() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function urlHasAutoStart() {
  return getSearchParams().get(AUTO_START_PARAM) === "true";
}

function getAdminTokenFromUrl() {
  return getSearchParams().get(ADMIN_QUERY_PARAM) || "";
}

function getAccessTokenFromUrl() {
  return getSearchParams().get(ACCESS_QUERY_PARAM) || "";
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function warningText(seconds) {
  if (seconds === 1800) return "30 minute warning";
  if (seconds === 600) return "10 minute warning";
  if (seconds === 300) return "5 minute warning";
  return "Time warning";
}

function buildManifestUrl(value) {
  try {
    return new URL(value, window.location.href).toString();
  } catch {
    return value;
  }
}

function buildPublicLaunchUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(ADMIN_QUERY_PARAM);
    url.searchParams.delete(ACCESS_QUERY_PARAM);
    return url.toString();
  } catch {
    return window.location.href;
  }
}

function copyText(value) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    return Promise.reject(new Error("Clipboard not available"));
  }
  return navigator.clipboard.writeText(value);
}

function setMetaContent(name, content, attribute = "name") {
  if (typeof document === "undefined") return;
  const selector = `meta[${attribute}="${name}"]`;
  const node = document.head.querySelector(selector);
  if (node) {
    node.setAttribute("content", content);
  }
}

function resolveAssetUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl || window.location.href).toString();
  } catch {
    return value;
  }
}

function normalizeQuestion(question, index, assetBaseUrl) {
  const source = question && typeof question === "object" ? question : {};
  const questionId = source.id != null ? String(source.id) : String(index + 1);
  const correct = String(source.correct || "").toLowerCase();

  return {
    id: questionId,
    promptImage: resolveAssetUrl(source.promptImage || source.questionImage || source.frontImage || null, assetBaseUrl),
    figureImage: resolveAssetUrl(source.figureImage || source.supportingImage || source.image || null, assetBaseUrl),
    answerKeyImage: resolveAssetUrl(source.answerKeyImage || source.explanationImage || source.backImage || null, assetBaseUrl),
    correct: VALID_OPTIONS.includes(correct) ? correct : "",
  };
}

function buildAuthorizedStartUrl(value, accessToken, autoStart) {
  try {
    const url = new URL(value, window.location.href);
    if (accessToken) {
      url.searchParams.set(ACCESS_QUERY_PARAM, accessToken);
    }
    if (autoStart) {
      url.searchParams.set(AUTO_START_PARAM, "true");
    } else {
      url.searchParams.delete(AUTO_START_PARAM);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeExamManifest(manifest, sourceLabel, assetBaseUrl) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`The exam manifest from ${sourceLabel} is not a valid object.`);
  }

  if (!Array.isArray(manifest.questions) || manifest.questions.length === 0) {
    throw new Error(`The exam manifest from ${sourceLabel} must include a non-empty questions array.`);
  }

  const questions = manifest.questions
    .map((question, index) => normalizeQuestion(question, index, assetBaseUrl))
    .filter((question) => question.promptImage || question.figureImage);
  if (questions.length === 0) {
    throw new Error(`The exam manifest from ${sourceLabel} does not contain any usable image-based questions.`);
  }

  const durationMinutes = Number(manifest.durationMinutes) > 0 ? Number(manifest.durationMinutes) : DEFAULT_EXAM_MINUTES;
  const warningThresholds = Array.isArray(manifest.warningThresholdsSeconds)
    ? manifest.warningThresholdsSeconds.map((value) => Number(value)).filter((value) => value > 0)
    : DEFAULT_WARNING_THRESHOLDS;

  return {
    id: String(manifest.id || sourceLabel || "image-practice-exam"),
    title: manifest.title || "Image Practice Exam",
    description: manifest.description || "Timed image-based practice test.",
    version: manifest.version ? String(manifest.version) : "1",
    durationMinutes,
    adminResetToken: manifest.adminResetToken ? String(manifest.adminResetToken) : "",
    startAccessToken: manifest.startAccessToken ? String(manifest.startAccessToken) : "",
    warningThresholds,
    questions,
  };
}

async function resolveExam() {
  const params = getSearchParams();
  const requestedExamId = params.get(EXAM_QUERY_PARAM);
  const explicitManifest = params.get(MANIFEST_QUERY_PARAM);
  const defaultManifest = !requestedExamId && !explicitManifest ? window.PRACTICE_TEST_DEFAULT_MANIFEST || "" : "";
  const requestedManifest = explicitManifest || defaultManifest;
  const examCatalog = window.PRACTICE_TEST_EXAMS || {};

  if (requestedManifest) {
    const manifestUrl = buildManifestUrl(requestedManifest);
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Unable to load exam manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = await response.json();
    const exam = normalizeExamManifest(manifest, manifestUrl, manifestUrl);
    return {
      exam,
      sourceLabel: explicitManifest ? "Custom manifest" : "Default exam",
      launchUrl: buildPublicLaunchUrl(),
      manifestUrl,
    };
  }

  const availableExamIds = Object.keys(examCatalog);
  const selectedExamId = requestedExamId && examCatalog[requestedExamId] ? requestedExamId : availableExamIds[0];

  if (!selectedExamId) {
    throw new Error("No built-in exams are configured.");
  }

  const exam = normalizeExamManifest(examCatalog[selectedExamId], `built-in exam "${selectedExamId}"`, window.location.href);
  const url = new URL(buildPublicLaunchUrl(), window.location.href);
  url.searchParams.set(EXAM_QUERY_PARAM, selectedExamId);
  return {
    exam,
    sourceLabel: "Built-in exam",
    launchUrl: url.toString(),
    manifestUrl: null,
  };
}

function buildStorageKey(exam) {
  return `practice-test-session::${exam.id}`;
}

function createEmptySession(exam, autoStart) {
  return {
    currentIndex: 0,
    answers: {},
    flagged: {},
    remainingSeconds: exam.durationMinutes * 60,
    started: !!autoStart,
    submitted: false,
    reviewOpen: false,
    dismissedWarnings: [],
    postExamFilter: "all",
  };
}

function sanitizeSession(rawSession, exam, autoStart) {
  const fallback = createEmptySession(exam, autoStart);
  if (!rawSession || typeof rawSession !== "object") {
    return fallback;
  }

  const validIds = new Set(exam.questions.map((question) => question.id));
  const answers = {};
  const flagged = {};

  if (rawSession.answers && typeof rawSession.answers === "object") {
    Object.entries(rawSession.answers).forEach(([questionId, answer]) => {
      const normalizedAnswer = String(answer || "").toLowerCase();
      if (validIds.has(String(questionId)) && VALID_OPTIONS.includes(normalizedAnswer)) {
        answers[String(questionId)] = normalizedAnswer;
      }
    });
  }

  if (rawSession.flagged && typeof rawSession.flagged === "object") {
    Object.entries(rawSession.flagged).forEach(([questionId, value]) => {
      if (validIds.has(String(questionId)) && !!value) {
        flagged[String(questionId)] = true;
      }
    });
  }

  const maxIndex = Math.max(exam.questions.length - 1, 0);
  const currentIndex = Number.isInteger(rawSession.currentIndex)
    ? Math.min(Math.max(rawSession.currentIndex, 0), maxIndex)
    : 0;

  const remainingSeconds = Number.isFinite(rawSession.remainingSeconds)
    ? Math.min(Math.max(Number(rawSession.remainingSeconds), 0), exam.durationMinutes * 60)
    : fallback.remainingSeconds;

  return {
    currentIndex,
    answers,
    flagged,
    remainingSeconds,
    started: rawSession.submitted ? true : !!rawSession.started || !!autoStart,
    submitted: !!rawSession.submitted,
    reviewOpen: rawSession.submitted ? false : !!rawSession.reviewOpen,
    dismissedWarnings: Array.isArray(rawSession.dismissedWarnings)
      ? rawSession.dismissedWarnings.filter((value) => exam.warningThresholds.includes(value))
      : [],
    postExamFilter: rawSession.postExamFilter === "flagged" ? "flagged" : "all",
  };
}

function loadSession(storageKey, exam, autoStart) {
  try {
    const raw = localStorage.getItem(storageKey);
    return sanitizeSession(raw ? JSON.parse(raw) : null, exam, autoStart);
  } catch {
    return createEmptySession(exam, autoStart);
  }
}

function saveSession(storageKey, session) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(session));
  } catch {
    // Ignore storage failures so the exam can still run.
  }
}

function StatusPill({ label, value }) {
  return React.createElement(
    "div",
    { className: "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm" },
    React.createElement("span", { className: "font-semibold" }, `${label}: `),
    value
  );
}

function QuestionImage({ src, alt }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src) return null;

  if (failed) {
    return React.createElement(
      "div",
      { className: "rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900" },
      React.createElement("div", { className: "font-semibold" }, "Image unavailable"),
      React.createElement(
        "p",
        { className: "mt-2 leading-6" },
        "This image could not be loaded. Check the manifest path and deployed asset location."
      ),
      React.createElement("p", { className: "mt-2 break-all font-mono text-xs text-amber-800" }, src)
    );
  }

  return React.createElement("img", {
    src,
    alt,
    onError: () => setFailed(true),
    className: "w-full rounded-3xl border border-slate-200 bg-white shadow-sm",
  });
}

function ExamPlayer({ exam, sourceLabel, launchUrl, manifestUrl }) {
  const storageKey = useMemo(() => buildStorageKey(exam), [exam]);
  const [session, setSession] = useState(() => loadSession(storageKey, exam, urlHasAutoStart()));
  const [activeWarning, setActiveWarning] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [copyReadyState, setCopyReadyState] = useState("idle");
  const [copyReadyAutoState, setCopyReadyAutoState] = useState("idle");
  const adminMode = exam.adminResetToken && getAdminTokenFromUrl() === exam.adminResetToken;
  const startAuthorized = !exam.startAccessToken || getAccessTokenFromUrl() === exam.startAccessToken || adminMode;
  const readyStudentUrl = useMemo(
    () => buildAuthorizedStartUrl(launchUrl, exam.startAccessToken, false),
    [launchUrl, exam.startAccessToken]
  );
  const readyStudentAutoStartUrl = useMemo(
    () => buildAuthorizedStartUrl(launchUrl, exam.startAccessToken, true),
    [launchUrl, exam.startAccessToken]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = `${exam.title} | Practice Exam`;
    setMetaContent("description", exam.description);
    setMetaContent("og:title", exam.title, "property");
    setMetaContent("og:description", exam.description, "property");
  }, [exam.title, exam.description]);

  useEffect(() => {
    setSession(loadSession(storageKey, exam, urlHasAutoStart()));
    setActiveWarning(null);
    setCopyState("idle");
    setCopyReadyState("idle");
    setCopyReadyAutoState("idle");
  }, [storageKey, exam]);

  useEffect(() => {
    saveSession(storageKey, session);
  }, [storageKey, session]);

  useEffect(() => {
    if (!startAuthorized && session.started && !session.submitted) {
      setSession((previous) => ({ ...previous, started: false, reviewOpen: false }));
      return undefined;
    }
  }, [startAuthorized, session.started, session.submitted]);

  useEffect(() => {
    if (!startAuthorized || !session.started || session.submitted) return undefined;
    if (session.remainingSeconds <= 0) {
      setSession((previous) => ({
        ...previous,
        submitted: true,
        reviewOpen: false,
        currentIndex: 0,
        postExamFilter: previous.postExamFilter || "all",
      }));
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSession((previous) => {
        if (!previous.started || previous.submitted) {
          return previous;
        }

        const nextRemaining = Math.max(previous.remainingSeconds - 1, 0);
        return {
          ...previous,
          remainingSeconds: nextRemaining,
          submitted: nextRemaining === 0 ? true : previous.submitted,
          reviewOpen: nextRemaining === 0 ? false : previous.reviewOpen,
          currentIndex: nextRemaining === 0 ? 0 : previous.currentIndex,
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [startAuthorized, session.started, session.submitted, session.remainingSeconds]);

  useEffect(() => {
    if (session.submitted) return;
    const threshold = exam.warningThresholds.find(
      (value) => session.remainingSeconds === value && !session.dismissedWarnings.includes(value)
    );

    if (!threshold) return;

    setActiveWarning(threshold);
    setSession((previous) => ({
      ...previous,
      dismissedWarnings: [...previous.dismissedWarnings, threshold],
    }));
  }, [exam.warningThresholds, session.remainingSeconds, session.dismissedWarnings, session.submitted]);

  const questions = exam.questions;
  const currentQuestion = questions[session.currentIndex];
  const flaggedQuestions = questions.filter((question) => !!session.flagged[question.id]);
  const answeredCount = questions.filter((question) => !!session.answers[question.id]).length;
  const flaggedCount = flaggedQuestions.length;
  const score = questions.reduce((total, question) => total + (session.answers[question.id] === question.correct ? 1 : 0), 0);

  function updateSession(updater) {
    setSession((previous) => updater(previous));
  }

  function startExam() {
    if (!startAuthorized) return;
    updateSession((previous) => ({ ...previous, started: true, reviewOpen: false }));
  }

  function selectOption(questionId, optionId) {
    if (session.submitted || !startAuthorized) return;
    updateSession((previous) => ({
      ...previous,
      started: true,
      answers: { ...previous.answers, [questionId]: optionId },
    }));
  }

  function toggleFlag(questionId) {
    if (!startAuthorized && !adminMode) return;
    updateSession((previous) => ({
      ...previous,
      started: true,
      flagged: { ...previous.flagged, [questionId]: !previous.flagged[questionId] },
    }));
  }

  function goToQuestion(index) {
    if (!startAuthorized && !adminMode) return;
    updateSession((previous) => ({
      ...previous,
      currentIndex: Math.max(0, Math.min(index, questions.length - 1)),
      started: true,
      reviewOpen: false,
    }));
  }

  function nextQuestion() {
    goToQuestion(session.currentIndex + 1);
  }

  function previousQuestion() {
    goToQuestion(session.currentIndex - 1);
  }

  function openReview() {
    if (!startAuthorized) return;
    updateSession((previous) => ({ ...previous, started: true, reviewOpen: true }));
  }

  function closeReview() {
    updateSession((previous) => ({ ...previous, reviewOpen: false }));
  }

  function submitExam() {
    updateSession((previous) => ({
      ...previous,
      submitted: true,
      started: true,
      reviewOpen: false,
      currentIndex: 0,
      postExamFilter: "all",
    }));
  }

  function resetExam() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures.
    }
    setActiveWarning(null);
    setCopyState("idle");
    setSession(createEmptySession(exam, false));
  }

  function reviewClass(question, isCurrent) {
    const answered = !!session.answers[question.id];
    const flagged = !!session.flagged[question.id];

    if (isCurrent) return "border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-200";
    if (flagged && answered) return "border-amber-500 bg-amber-200 text-amber-950";
    if (flagged) return "border-rose-300 bg-rose-100 text-rose-900";
    if (answered) return "border-emerald-400 bg-emerald-100 text-emerald-900";
    return "border-slate-300 bg-white text-slate-700";
  }

  function optionClass(optionId, question) {
    const selected = session.answers[question.id] === optionId;

    if (!session.submitted) {
      return selected
        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
        : "border-slate-300 bg-white hover:border-slate-400";
    }

    const isCorrect = question.correct === optionId;
    if (isCorrect) return "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200";
    if (selected && !isCorrect) return "border-rose-500 bg-rose-50 ring-2 ring-rose-200";
    return "border-slate-300 bg-white";
  }

  async function copyLaunchLink() {
    try {
      await copyText(launchUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  async function copyReadyLink(urlValue, setter) {
    try {
      await copyText(urlValue);
      setter("copied");
      window.setTimeout(() => setter("idle"), 1500);
    } catch {
      setter("error");
      window.setTimeout(() => setter("idle"), 2000);
    }
  }

  function triggerWarning(seconds) {
    setActiveWarning(seconds);
  }

  const resultsList = session.postExamFilter === "flagged" ? flaggedQuestions : questions;

  return React.createElement(
    "div",
    { className: "min-h-screen bg-slate-100 text-slate-900" },
    activeWarning &&
      React.createElement(
        "div",
        { className: "fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" },
        React.createElement(
          "div",
          { className: "w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200" },
          React.createElement("h2", { className: "text-2xl font-bold tracking-tight" }, warningText(activeWarning)),
          React.createElement(
            "p",
            { className: "mt-2 text-sm text-slate-600" },
            `Time remaining: ${formatTime(session.remainingSeconds)}`
          ),
          React.createElement(
            "button",
            {
              onClick: () => setActiveWarning(null),
              className: "mt-5 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700",
            },
            "Continue Exam"
          )
        )
      ),
    React.createElement(
      "div",
      { className: "mx-auto max-w-7xl p-4 md:p-6" },
      React.createElement(
        "div",
        { className: "mb-6 rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200" },
        React.createElement(
          "div",
          { className: "flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between" },
          React.createElement(
            "div",
            { className: "max-w-3xl" },
            React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-500" }, sourceLabel),
            React.createElement("h1", { className: "mt-2 text-3xl font-bold tracking-tight text-slate-950" }, exam.title),
            React.createElement("p", { className: "mt-2 text-sm leading-6 text-slate-600" }, exam.description),
            React.createElement(
              "div",
              { className: "mt-4 flex flex-wrap gap-2 text-xs text-slate-500" },
              React.createElement("span", { className: "rounded-full bg-slate-100 px-3 py-1" }, `${questions.length} questions`),
              React.createElement("span", { className: "rounded-full bg-slate-100 px-3 py-1" }, `${exam.durationMinutes} minutes`),
              React.createElement("span", { className: "rounded-full bg-slate-100 px-3 py-1" }, `v${exam.version}`),
              manifestUrl && React.createElement("span", { className: "rounded-full bg-slate-100 px-3 py-1" }, "Custom manifest"),
              urlHasAutoStart() && React.createElement("span", { className: "rounded-full bg-blue-100 px-3 py-1 text-blue-900" }, "Auto-start link"),
              exam.startAccessToken &&
                React.createElement(
                  "span",
                  {
                    className: `rounded-full px-3 py-1 ${
                      startAuthorized ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
                    }`,
                  },
                  startAuthorized ? "Startable" : "Locked"
                ),
              adminMode && React.createElement("span", { className: "rounded-full bg-rose-100 px-3 py-1 text-rose-900" }, "Admin mode")
            )
          ),
          React.createElement(
            "div",
            { className: "flex w-full max-w-xl flex-col gap-3" },
            React.createElement(
              "div",
              { className: "rounded-3xl border border-slate-200 bg-slate-50 p-4" },
              React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-500" }, "Launch link"),
              React.createElement("p", { className: "mt-2 break-all text-sm text-slate-700" }, launchUrl),
              React.createElement(
                "div",
                { className: "mt-3 flex flex-wrap gap-3" },
                React.createElement(
                  "button",
                  {
                    onClick: copyLaunchLink,
                    className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100",
                  },
                  copyState === "copied" ? "Link copied" : copyState === "error" ? "Copy failed" : "Copy launch link"
                ),
                adminMode &&
                  exam.startAccessToken &&
                  React.createElement(
                    "button",
                    {
                      onClick: () => copyReadyLink(readyStudentUrl, setCopyReadyState),
                      className: "rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100",
                    },
                    copyReadyState === "copied"
                      ? "Startable link copied"
                      : copyReadyState === "error"
                      ? "Copy failed"
                      : "Copy startable student link"
                  ),
                adminMode &&
                  exam.startAccessToken &&
                  React.createElement(
                    "button",
                    {
                      onClick: () => copyReadyLink(readyStudentAutoStartUrl, setCopyReadyAutoState),
                      className: "rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100",
                    },
                    copyReadyAutoState === "copied"
                      ? "Auto-start link copied"
                      : copyReadyAutoState === "error"
                      ? "Copy failed"
                      : "Copy startable auto-start link"
                  ),
                adminMode &&
                  React.createElement(
                    "button",
                    {
                      onClick: resetExam,
                      className: "rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100",
                    },
                    "Reset Attempt"
                  )
              )
            ),
            adminMode &&
              React.createElement(
                "div",
                { className: "rounded-3xl border border-slate-200 bg-slate-50 p-4" },
                React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-500" }, "Admin warning triggers"),
                React.createElement(
                  "div",
                  { className: "mt-3 flex flex-wrap gap-3" },
                  React.createElement(
                    "button",
                    {
                      onClick: () => triggerWarning(1800),
                      className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100",
                    },
                    "Trigger 30 min"
                  ),
                  React.createElement(
                    "button",
                    {
                      onClick: () => triggerWarning(600),
                      className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100",
                    },
                    "Trigger 10 min"
                  ),
                  React.createElement(
                    "button",
                    {
                      onClick: () => triggerWarning(300),
                      className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100",
                    },
                    "Trigger 5 min"
                  )
                )
              ),
            React.createElement(
              "div",
              { className: "flex flex-wrap gap-3" },
              React.createElement(StatusPill, { label: "Time", value: formatTime(session.remainingSeconds) }),
              React.createElement(StatusPill, { label: "Answered", value: `${answeredCount}/${questions.length}` }),
              React.createElement(StatusPill, { label: "Flagged", value: String(flaggedCount) })
            )
          )
        )
      ),
      !startAuthorized
        ? React.createElement(
            "div",
            { className: "grid gap-6 lg:grid-cols-[1.1fr,0.9fr]" },
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-slate-200" },
              React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-amber-600" }, "Exam locked"),
              React.createElement("h2", { className: "mt-2 text-2xl font-semibold tracking-tight text-slate-950" }, "This exam is not startable yet"),
              React.createElement(
                "p",
                { className: "mt-3 text-sm leading-6 text-slate-600" },
                "The exam link has been opened, but start access has not been released yet. You can review the title and instructions, but the exam cannot be started from this link."
              ),
              React.createElement(
                "div",
                { className: "mt-8 flex flex-wrap gap-3" },
                React.createElement(
                  "button",
                  {
                    disabled: true,
                    className: "cursor-not-allowed rounded-2xl bg-slate-300 px-5 py-3 text-sm font-medium text-slate-600",
                  },
                  "Start Locked"
                )
              )
            ),
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-slate-950 p-8 text-slate-50 shadow-sm" },
              React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" }, "Student view"),
              React.createElement(
                "ul",
                { className: "mt-5 space-y-4 text-sm leading-6 text-slate-300" },
                React.createElement("li", null, "The student can open the exam link before the release time."),
                React.createElement("li", null, "The student cannot start the timer or answer questions from the locked link."),
                React.createElement("li", null, "When you are ready, send the startable student link generated from the admin link.")
              )
            )
          )
        : !session.started && !session.submitted
        ? React.createElement(
            "div",
            { className: "grid gap-6 lg:grid-cols-[1.1fr,0.9fr]" },
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-slate-200" },
              React.createElement("h2", { className: "text-2xl font-semibold tracking-tight text-slate-950" }, "Timed exam flow"),
              React.createElement(
                "p",
                { className: "mt-3 text-sm leading-6 text-slate-600" },
                "This exam follows a simple start, review, submit, and post-exam answer-key workflow."
              ),
              React.createElement(
                "ol",
                { className: "mt-5 space-y-3 text-sm leading-6 text-slate-700" },
                React.createElement("li", null, "1. Start the exam and work through the questions in order or by navigation."),
                React.createElement("li", null, "2. Flag any questions you want to revisit before submitting."),
                React.createElement("li", null, "3. Reach the final question to unlock the final review screen."),
                React.createElement("li", null, "4. Submit the exam and review the answer key images afterward.")
              ),
              React.createElement(
                "div",
                { className: "mt-8 grid gap-4 sm:grid-cols-2" },
                React.createElement(
                  "div",
                  { className: "rounded-3xl border border-slate-200 bg-slate-50 p-5" },
                  React.createElement("div", { className: "text-3xl font-bold tracking-tight" }, questions.length),
                  React.createElement("div", { className: "mt-2 text-sm text-slate-600" }, "Image-based questions")
                ),
                React.createElement(
                  "div",
                  { className: "rounded-3xl border border-slate-200 bg-slate-50 p-5" },
                  React.createElement("div", { className: "text-3xl font-bold tracking-tight" }, exam.durationMinutes),
                  React.createElement("div", { className: "mt-2 text-sm text-slate-600" }, "Minutes total")
                ),
                React.createElement(
                  "div",
                  { className: "rounded-3xl border border-slate-200 bg-slate-50 p-5" },
                  React.createElement("div", { className: "text-3xl font-bold tracking-tight" }, "A-D"),
                  React.createElement("div", { className: "mt-2 text-sm text-slate-600" }, "Clickable answer choices")
                ),
                React.createElement(
                  "div",
                  { className: "rounded-3xl border border-slate-200 bg-slate-50 p-5" },
                  React.createElement("div", { className: "text-3xl font-bold tracking-tight" }, "Review"),
                  React.createElement("div", { className: "mt-2 text-sm text-slate-600" }, "Answered, unanswered, and flagged status")
                )
              ),
              React.createElement(
                "div",
                { className: "mt-8 flex flex-wrap gap-3" },
                React.createElement(
                  "button",
                  {
                    onClick: startExam,
                    className: "rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700",
                  },
                  "Start Exam"
                ),
                adminMode &&
                  React.createElement(
                    "button",
                    {
                      onClick: resetExam,
                      className: "rounded-2xl border border-rose-300 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-900 hover:bg-rose-100",
                    },
                    "Clear Saved Progress"
                  )
              )
            ),
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-slate-950 p-8 text-slate-50 shadow-sm" },
              React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" }, "Before you begin"),
              React.createElement(
                "ul",
                { className: "mt-5 space-y-4 text-sm leading-6 text-slate-300" },
                React.createElement("li", null, "You will have 75 minutes to complete 50 questions once the exam begins."),
                React.createElement("li", null, "Answer each question by selecting A, B, C, or D."),
                React.createElement("li", null, "Use the flag button to mark questions you want to revisit before submitting."),
                React.createElement("li", null, "You will receive time warnings when 30 minutes, 10 minutes, and 5 minutes remain."),
                React.createElement("li", null, "The final review screen becomes available when you reach the last question."),
                React.createElement("li", null, "After submission, you can review the answer key images for each question.")
              )
            )
          )
        : session.reviewOpen && !session.submitted
        ? React.createElement(
            "div",
            { className: "rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-slate-200" },
            React.createElement("h2", { className: "text-2xl font-semibold tracking-tight" }, "Final Review Before Submit"),
            React.createElement(
              "p",
              { className: "mt-2 text-sm text-slate-600" },
              "Review answered, unanswered, and flagged questions before you submit."
            ),
            React.createElement(
              "div",
              { className: "mt-4 flex flex-wrap gap-2 text-xs" },
              React.createElement("span", { className: "rounded-full bg-emerald-100 px-3 py-1 text-emerald-900" }, "Answered"),
              React.createElement("span", { className: "rounded-full bg-white px-3 py-1 text-slate-700 ring-1 ring-slate-300" }, "Unanswered"),
              React.createElement("span", { className: "rounded-full bg-rose-100 px-3 py-1 text-rose-900" }, "Flagged"),
              React.createElement("span", { className: "rounded-full bg-amber-200 px-3 py-1 text-amber-950" }, "Answered + flagged")
            ),
            React.createElement(
              "div",
              { className: "mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" },
              ...questions.map((question, index) =>
                React.createElement(
                  "button",
                  {
                    key: question.id,
                    onClick: () => goToQuestion(index),
                    className: `rounded-3xl border p-4 text-left transition ${reviewClass(question, index === session.currentIndex)}`,
                  },
                  React.createElement("div", { className: "text-sm font-semibold" }, `Question ${question.id}`),
                  React.createElement(
                    "div",
                    { className: "mt-2 text-xs" },
                    session.answers[question.id]
                      ? `Answered: ${String(session.answers[question.id]).toUpperCase()}`
                      : "Unanswered"
                  ),
                  React.createElement("div", { className: "mt-1 text-xs" }, session.flagged[question.id] ? "Flagged" : "")
                )
              )
            ),
            React.createElement(
              "div",
              { className: "mt-6 flex flex-wrap gap-3" },
              React.createElement(
                "button",
                {
                  onClick: closeReview,
                  className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50",
                },
                "Back to Exam"
              ),
              React.createElement(
                "button",
                {
                  onClick: submitExam,
                  className: "rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500",
                },
                "Submit Exam"
              )
            )
          )
        : session.submitted
        ? React.createElement(
            "div",
            { className: "grid gap-6 lg:grid-cols-[320px,1fr]" },
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-slate-200" },
              React.createElement("h2", { className: "text-2xl font-semibold tracking-tight" }, "Results"),
              React.createElement("p", { className: "mt-2 text-5xl font-bold tracking-tight text-slate-950" }, `${score}/${questions.length}`),
              React.createElement("p", { className: "mt-2 text-sm text-slate-600" }, "Use the filters below to review all questions or jump directly to the flagged ones."),
              React.createElement(
                "div",
                { className: "mt-5 flex flex-col gap-2" },
                React.createElement(
                  "button",
                  {
                    onClick: () => updateSession((previous) => ({ ...previous, postExamFilter: "all", currentIndex: 0 })),
                    className: `rounded-2xl px-4 py-2 text-sm font-medium ${
                      session.postExamFilter === "all" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"
                    }`,
                  },
                  "Review All Questions"
                ),
                React.createElement(
                  "button",
                  {
                    onClick: () =>
                      updateSession((previous) => ({
                        ...previous,
                        postExamFilter: "flagged",
                        currentIndex: flaggedQuestions.length
                          ? questions.findIndex((question) => question.id === flaggedQuestions[0].id)
                          : 0,
                      })),
                    className: `rounded-2xl px-4 py-2 text-sm font-medium ${
                      session.postExamFilter === "flagged" ? "bg-yellow-500 text-white" : "border border-slate-300 bg-white"
                    }`,
                  },
                  `Review Flagged Questions (${flaggedCount})`
                )
              ),
              React.createElement(
                "div",
                { className: "mt-5 space-y-2" },
                resultsList.length
                  ? resultsList.map((question) => {
                      const index = questions.findIndex((item) => item.id === question.id);
                      const correct = session.answers[question.id] === question.correct;
                      return React.createElement(
                        "button",
                        {
                          key: question.id,
                          onClick: () => goToQuestion(index),
                          className: `flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm ${
                            correct ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
                          }`,
                        },
                        React.createElement("span", null, `Question ${question.id}${session.flagged[question.id] ? " • flagged" : ""}`),
                        React.createElement("span", null, correct ? "Correct" : "Incorrect")
                      );
                    })
                  : React.createElement(
                      "div",
                      { className: "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600" },
                      "No flagged questions were saved during this attempt."
                    )
              )
            ),
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-slate-200" },
              currentQuestion &&
                React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    "div",
                    { className: "mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between" },
                    React.createElement(
                      "div",
                      null,
                      React.createElement("h2", { className: "text-2xl font-semibold tracking-tight" }, `Question ${currentQuestion.id}`),
                      React.createElement(
                        "p",
                        { className: "mt-1 text-sm text-slate-600" },
                        session.flagged[currentQuestion.id]
                          ? "This question was flagged during the exam."
                          : "This question was not flagged during the exam."
                      )
                    ),
                    React.createElement(
                      "div",
                      { className: "rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" },
                      "Your answer: ",
                      React.createElement("span", { className: "font-semibold uppercase" }, session.answers[currentQuestion.id] || "-"),
                      React.createElement("span", { className: "mx-2 text-slate-300" }, "|"),
                      "Correct: ",
                      React.createElement("span", { className: "font-semibold uppercase" }, currentQuestion.correct || "-")
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "space-y-4" },
                    React.createElement(QuestionImage, {
                      src: currentQuestion.promptImage,
                      alt: `Question ${currentQuestion.id} prompt`,
                    }),
                    React.createElement(QuestionImage, {
                      src: currentQuestion.figureImage,
                      alt: `Question ${currentQuestion.id} figure`,
                    }),
                    React.createElement(
                      "div",
                      { className: "grid gap-3 md:grid-cols-2" },
                      ...VALID_OPTIONS.map((optionId) =>
                        React.createElement(
                          "div",
                          {
                            key: optionId,
                            className: `rounded-2xl border p-5 ${optionClass(optionId, currentQuestion)}`,
                          },
                          React.createElement("div", { className: "text-lg font-semibold uppercase" }, `${optionId}.`),
                          React.createElement(
                            "div",
                            { className: "mt-3 h-5 text-xs font-medium" },
                            currentQuestion.correct === optionId
                              ? "Correct"
                              : session.answers[currentQuestion.id] === optionId
                              ? "Your answer"
                              : ""
                          )
                        )
                      )
                    ),
                    currentQuestion.answerKeyImage &&
                      React.createElement(
                        "div",
                        null,
                        React.createElement("h3", { className: "mb-2 text-lg font-semibold" }, "Answer Key Image"),
                        React.createElement(QuestionImage, {
                          src: currentQuestion.answerKeyImage,
                          alt: `Question ${currentQuestion.id} answer key`,
                        })
                      )
                  )
                )
            )
          )
        : React.createElement(
            "div",
            { className: "grid gap-6 lg:grid-cols-[300px,1fr]" },
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-slate-200" },
              React.createElement("h2", { className: "text-xl font-semibold tracking-tight" }, "Navigator"),
              React.createElement("p", { className: "mt-2 text-sm text-slate-600" }, "Jump between questions and flag items to revisit later."),
              React.createElement(
                "div",
                { className: "mt-4 grid grid-cols-3 gap-3" },
                ...questions.map((question, index) =>
                  React.createElement(
                    "button",
                    {
                      key: question.id,
                      onClick: () => goToQuestion(index),
                      className: `rounded-2xl border px-3 py-4 text-sm font-medium transition ${reviewClass(
                        question,
                        index === session.currentIndex
                      )}`,
                    },
                    `Q${question.id}`
                  )
                )
              )
            ),
            React.createElement(
              "div",
              { className: "rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-slate-200" },
              currentQuestion &&
                React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    "div",
                    { className: "mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between" },
                    React.createElement(
                      "div",
                      null,
                      React.createElement("h2", { className: "text-2xl font-semibold tracking-tight" }, `Question ${currentQuestion.id}`),
                      React.createElement(
                        "p",
                        { className: "mt-1 text-sm text-slate-600" },
                        "Answer by clicking A, B, C, or D. The question content is shown only through images."
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        onClick: () => toggleFlag(currentQuestion.id),
                        className: session.flagged[currentQuestion.id]
                          ? "rounded-2xl bg-yellow-100 px-4 py-2 text-sm font-medium text-yellow-900 ring-1 ring-yellow-300"
                          : "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50",
                      },
                      session.flagged[currentQuestion.id] ? "Flagged" : "Flag Question"
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "space-y-4" },
                    React.createElement(QuestionImage, {
                      src: currentQuestion.promptImage,
                      alt: `Question ${currentQuestion.id} prompt`,
                    }),
                    React.createElement(QuestionImage, {
                      src: currentQuestion.figureImage,
                      alt: `Question ${currentQuestion.id} figure`,
                    }),
                    React.createElement(
                      "div",
                      { className: "grid gap-3 md:grid-cols-2" },
                      ...VALID_OPTIONS.map((optionId) =>
                        React.createElement(
                          "button",
                          {
                            key: optionId,
                            onClick: () => selectOption(currentQuestion.id, optionId),
                            className: `rounded-2xl border p-5 text-left transition ${optionClass(optionId, currentQuestion)}`,
                          },
                          React.createElement("div", { className: "text-lg font-semibold uppercase" }, `${optionId}.`),
                          React.createElement(
                            "div",
                            { className: "mt-3 h-4 text-xs text-slate-500" },
                            session.answers[currentQuestion.id] === optionId ? "Selected" : ""
                          )
                        )
                      )
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "mt-6 flex flex-wrap items-center justify-between gap-3" },
                    React.createElement(
                      "div",
                      { className: "flex gap-3" },
                      React.createElement(
                        "button",
                        {
                          onClick: previousQuestion,
                          className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50",
                        },
                        "Previous"
                      ),
                      React.createElement(
                        "button",
                        {
                          onClick: nextQuestion,
                          className: "rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50",
                        },
                        "Next"
                      )
                    ),
                    session.currentIndex === questions.length - 1 &&
                      React.createElement(
                        "button",
                        {
                          onClick: openReview,
                          className: "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700",
                        },
                        "Go to Final Review"
                      )
                  )
                )
            )
          ),
      adminMode &&
        React.createElement(
          "div",
          { className: "mt-6 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-slate-200" },
          React.createElement("h2", { className: "text-lg font-semibold tracking-tight" }, "Manifest fields"),
          React.createElement(
            "div",
            { className: "mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2" },
            React.createElement(
              "div",
              { className: "rounded-2xl border border-slate-200 bg-slate-50 p-4" },
              React.createElement("div", { className: "font-semibold" }, "Exam"),
              React.createElement("p", { className: "mt-2 leading-6" }, "`id`, `title`, `description`, `durationMinutes`, `warningThresholdsSeconds`, `questions`")
            ),
            React.createElement(
              "div",
              { className: "rounded-2xl border border-slate-200 bg-slate-50 p-4" },
              React.createElement("div", { className: "font-semibold" }, "Question"),
              React.createElement("p", { className: "mt-2 leading-6" }, "`id`, `promptImage`, `figureImage`, `answerKeyImage`, `correct`")
            )
          )
        )
    )
  );
}

function App() {
  const [resolvedExam, setResolvedExam] = useState({
    status: "loading",
    exam: null,
    sourceLabel: "",
    launchUrl: "",
    manifestUrl: null,
    error: "",
  });

  useEffect(() => {
    let active = true;

    resolveExam()
      .then((result) => {
        if (!active) return;
        setResolvedExam({
          status: "ready",
          exam: result.exam,
          sourceLabel: result.sourceLabel,
          launchUrl: result.launchUrl,
          manifestUrl: result.manifestUrl,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        setResolvedExam({
          status: "error",
          exam: null,
          sourceLabel: "",
          launchUrl: "",
          manifestUrl: null,
          error: error && error.message ? error.message : "Unable to load the exam.",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  if (resolvedExam.status === "loading") {
    return React.createElement(
      "div",
      { className: "flex min-h-screen items-center justify-center bg-slate-100 p-6" },
      React.createElement(
        "div",
        { className: "w-full max-w-xl rounded-[2rem] bg-white p-8 text-center shadow-sm ring-1 ring-slate-200" },
        React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-slate-500" }, "Loading"),
        React.createElement("h1", { className: "mt-2 text-2xl font-semibold tracking-tight" }, "Preparing your image-based exam"),
        React.createElement("p", { className: "mt-3 text-sm text-slate-600" }, "The player is resolving the exam from the current link.")
      )
    );
  }

  if (resolvedExam.status === "error") {
    return React.createElement(
      "div",
      { className: "flex min-h-screen items-center justify-center bg-slate-100 p-6" },
      React.createElement(
        "div",
        { className: "w-full max-w-2xl rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-slate-200" },
        React.createElement("div", { className: "text-xs font-semibold uppercase tracking-[0.2em] text-rose-500" }, "Load error"),
        React.createElement("h1", { className: "mt-2 text-2xl font-semibold tracking-tight" }, "The exam could not be opened"),
        React.createElement("p", { className: "mt-3 text-sm leading-6 text-slate-600" }, resolvedExam.error),
        React.createElement(
          "div",
          { className: "mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700" },
          React.createElement("p", null, "Try one of these link formats:"),
          React.createElement("p", { className: "mt-3 font-mono text-xs leading-6" }, "?exam=sample-exam"),
          React.createElement("p", { className: "mt-1 font-mono text-xs leading-6" }, "?manifest=https://example.com/exam.json"),
          React.createElement("p", { className: "mt-1 font-mono text-xs leading-6" }, "?exam=sample-exam&start=true")
        )
      )
    );
  }

  return React.createElement(ExamPlayer, {
    exam: resolvedExam.exam,
    sourceLabel: resolvedExam.sourceLabel,
    launchUrl: resolvedExam.launchUrl,
    manifestUrl: resolvedExam.manifestUrl,
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
