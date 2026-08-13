import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

const corePath = path.resolve("verify_and_update_wp_core.js");
const runtimePath = path.resolve(".verify_and_update_wp_runtime.mjs");

let source = await fs.readFile(corePath, "utf8");

const oldNamedTeam = `    const cleanTeamName = (name) =>\n      normalize(name)\n        .replace(/\\s*\\([^)]{2,12}\\)\\s*$/g, "")\n        .trim();`;

const newNamedTeam = `    const cleanTeamName = (name) =>\n      normalize(\n        String(name || "")\n          .replace(/\\s*\\([^)]{2,12}\\)\\s*$/g, "")\n      )\n        .trim();`;

if (source.includes(oldNamedTeam)) {
  source = source.replace(oldNamedTeam, newNamedTeam);
} else if (!source.includes(newNamedTeam)) {
  throw new Error("Named-team verifier patch target was not found.");
}

await fs.writeFile(runtimePath, source, "utf8");

try {
  await import(`${pathToFileURL(runtimePath).href}?t=${Date.now()}`);
} finally {
  await fs.unlink(runtimePath).catch(() => {});
}
