import { readFile } from "node:fs/promises";

const source = process.env.INPUT_SOURCE;
const controlUrl = required("CONTROL_PLANE_URL").replace(/\/$/, "");
const token = required("CONTROL_API_TOKEN");

let body;
if (source === "live") {
  body = {
    source,
    liveMatches: await json("live-betting/data/live_matches.json"),
    liveSignals: await json("live-betting/data/signals.json"),
  };
} else if (source === "tickets") {
  body = { source, tickets: await json("tickets.json") };
} else {
  throw new Error("INPUT_SOURCE must be live or tickets");
}

const response = await fetch(`${controlUrl}/api/inputs`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!response.ok) throw new Error(`Control plane input upload failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
const result = await response.json();
console.log(`Published existing ${source} output to control plane at ${result.receivedAt}`);

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
