// verify_and_update_wp_runtime.js
// Compatibility launcher for verify_and_update_wp.js
//
// The previous version dynamically patched cleanTeamName() before running
// the verifier. That patch is obsolete because verify_and_update_wp.js
// has since been refactored.
//
// This launcher is intentionally kept so existing GitHub Actions workflows
// can continue calling verify_and_update_wp_runtime.js without modification.

import path from "path";
import { pathToFileURL } from "url";

const corePath = path.resolve("verify_and_update_wp.js");

console.log(
  `[VERIFY RUNTIME] Starting verifier: ${corePath}`
);

try {
  await import(
    `${pathToFileURL(corePath).href}?runtime=${Date.now()}`
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
}
