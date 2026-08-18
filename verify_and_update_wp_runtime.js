// verify_and_update_wp_runtime.js
// Runtime compatibility launcher for verify_and_update_wp.js
//
// Flashscore mobile can return finished matches in compact text such as:
//   4-2 (3-0,1-2)Finished17.08.2026
//
// The current production verifier uses \bFinished\b, which does not match
// when "Finished" is glued directly to the date. This launcher applies a
// narrow runtime patch without changing the production verifier file itself.

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const corePath = path.resolve("verify_and_update_wp.js");
const runtimePath = path.resolve(".verify_and_update_wp_runtime.mjs");

let source = await fs.readFile(corePath, "utf8");
let patched = false;

const oldFinishedCheck = `  const finished =\n    /\\bFinished\\b|\\bFT\\b|\\bAET\\b|After Penalties|After Extra Time|Final/i.test(\n      body\n    );`;

const newFinishedCheck = `  const finished =\n    /Finished|Full Time|After Penalties|After Extra Time|Final\\b|AET\\b|FT\\b/i.test(\n      body\n    );`;

if (source.includes(oldFinishedCheck)) {
  source = source.replace(oldFinishedCheck, newFinishedCheck);
  patched = true;
}

const oldScorePatterns = `  const scorePatterns = [\n    /Finished.*?(\\d+)\\s*[-:]\\s*(\\d+)/i,\n    /\\bFT\\b.*?(\\d+)\\s*[-:]\\s*(\\d+)/i,\n    /(\\d+)\\s*[-:]\\s*(\\d+).*?\\bFinished\\b/i,\n    /(\\d+)\\s*[-:]\\s*(\\d+).*?\\bFT\\b/i\n  ];`;

const newScorePatterns = `  const scorePatterns = [\n    // Flashscore mobile commonly puts score BEFORE status:\n    // 4-2 (3-0,1-2)Finished17.08.2026\n    /(\\d{1,2})\\s*[-:]\\s*(\\d{1,2})(?:\\s*\\([^)]*\\))?\\s*(?:Finished|Full Time|After Extra Time|After Penalties|Final\\b|AET\\b|FT\\b)/i,\n\n    // Fallback when status appears before score.\n    /(?:Finished|Full Time|After Extra Time|After Penalties|Final\\b|AET\\b|FT\\b)[^0-9]{0,120}(\\d{1,2})\\s*[-:]\\s*(\\d{1,2})/i\n  ];`;

if (source.includes(oldScorePatterns)) {
  source = source.replace(oldScorePatterns, newScorePatterns);
  patched = true;
}

if (patched) {
  console.log(
    "[VERIFY RUNTIME] Applied Flashscore compact Finished-status compatibility patch."
  );
} else {
  console.log(
    "[VERIFY RUNTIME] Compatibility patch was not needed or verifier format changed; running current verifier as-is."
  );
}

await fs.writeFile(runtimePath, source, "utf8");

console.log(
  `[VERIFY RUNTIME] Starting verifier: ${corePath}`
);

try {
  await import(
    `${pathToFileURL(runtimePath).href}?runtime=${Date.now()}`
  );

  console.log(
    "[VERIFY RUNTIME] Verifier completed."
  );
} catch (error) {
  console.error(
    "[VERIFY RUNTIME] Verifier failed:"
  );

  console.error(
    error?.stack || error?.message || error
  );

  process.exitCode = 1;
} finally {
  await fs.unlink(runtimePath).catch(() => {});
}
