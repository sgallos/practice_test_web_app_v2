// scripts/tests/run-all.js
//
// Runs every test file in this folder in its own process (so state from
// one file — mocked globals, env vars, require caches — can never leak
// into another) and fails loudly if any of them fail.
//
// Run with: node scripts/tests/run-all.js

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((name) => name.startsWith("test-") && name.endsWith(".js"))
  .sort();

let anyFailed = false;

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  try {
    execFileSync(process.execPath, [path.join(dir, file)], { stdio: "inherit" });
  } catch (err) {
    anyFailed = true;
  }
}

console.log(anyFailed ? "\nSome test files failed." : "\nAll test files passed.");
process.exitCode = anyFailed ? 1 : 0;
