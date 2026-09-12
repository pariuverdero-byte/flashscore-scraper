import fs from "node:fs";

const siteUrl = String(process.env.WP_URL || "").replace(/\/+$/, "");
const user = String(process.env.WP_USER || "");
const appPass = String(process.env.WP_APP_PASS || "");
const snippetName = "PV Network – Social links and Telegram invite";
if (!siteUrl || !user || !appPass) throw new Error("Missing WordPress deployment configuration");

const code = fs.readFileSync("site-enhancements/site-experience.php", "utf8");
const endpoint = `${siteUrl}/wp-json/code-snippets/v1/snippets`;
const headers = {
  Authorization: `Basic ${Buffer.from(`${user}:${appPass}`).toString("base64")}`,
  "Content-Type": "application/json",
};

const listResponse = await fetch(`${endpoint}?per_page=100&search=${encodeURIComponent(snippetName)}`, { headers });
if (!listResponse.ok) throw new Error(`Could not list snippets: HTTP ${listResponse.status}`);
const existing = (await listResponse.json()).find(item => item.name === snippetName);
const body = JSON.stringify({
  name: snippetName,
  desc: "Shared site enhancements, social links and optional PayPal support at 5, 15 and 30 minutes of visible browsing.",
  code,
  scope: "front-end",
  tags: ["pariuverde-network", "managed-by-github"],
  active: true,
  priority: 10,
});
const response = await fetch(existing ? `${endpoint}/${existing.id}` : endpoint, {
  method: "POST",
  headers,
  body,
});
const result = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Snippet deployment failed: ${result.message || `HTTP ${response.status}`}`);
console.log(`[SITE] ${siteUrl}: ${existing ? "updated" : "created"} snippet ${result.id}, active=${result.active}`);
