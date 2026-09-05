import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "manifests/chapter-1-full.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const chunkSize = 100;
const chunks = [];

for (let index = 0; index < source.questions.length; index += chunkSize) {
  chunks.push(source.questions.slice(index, index + chunkSize));
}

if (chunks.length !== 5 || chunks.slice(0, 4).some((chunk) => chunk.length !== 100)) {
  throw new Error("Expected four 100-question exams followed by one remainder exam.");
}

for (const [index, questions] of chunks.entries()) {
  const version = index + 1;
  const outputPath = resolve(
    projectRoot,
    `manifests/gyn-comprehensive-v${version}.json`,
  );
  const existing = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, "utf8"))
    : {};
  const questionCount = questions.length;
  const manifest = {
    id: `chapter-1-comprehensive-v${version}`,
    title: `ASCP BOC Chapter 1 Comprehensive Practice Exam Version ${version}`,
    description: `${questionCount}-question GYN practice exam drawn from the Chapter 1 question bank.`,
    version: String(version),
    durationMinutes: questionCount * 1.5,
    adminResetToken: existing.adminResetToken ?? randomUUID(),
    startAccessToken: existing.startAccessToken ?? randomUUID(),
    warningThresholdsSeconds: [1800, 600, 300],
    questions,
  };

  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${outputPath}: ${questionCount} questions, source ${questions[0].id}-${questions.at(-1).id}`,
  );
}
