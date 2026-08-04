// publish_wp.js
// FINAL — WordPress REST publishing with OpenResty/WAF fallback
// JSON request first, form-urlencoded fallback on HTML 400 response

import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
const LANG = (process.env.LANG || "ro").toLowerCase();

if (!WP_URL || !WP_USER || !WP_APP_PASS) {
  console.error("❌ Missing WP_URL / WP_USER / WP_APP_PASS");
  process.exit(1);
}

function normalizeApiBase(url) {
  const cleanUrl = String(url)
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/wp-json\/wp\/v2$/i, "")
    .replace(/\/wp-json$/i, "");

  return `${cleanUrl}/wp-json/wp/v2`;
}

const API_BASE = normalizeApiBase(WP_URL);
const POSTS_ENDPOINT = `${API_BASE}/posts`;

const auth =
  "Basic " +
  Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

const read = async (filePath) => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
};

// IMPORTANT:
// These IDs must correspond to categories on pariuverde.ro.
// They are not necessarily the same as on greenbettips.com.
const CATEGORY_IDS = {
  "cota-2": 7,
  "biletul-zilei": 8,
};

function sanitizeHtmlFragment(html = "") {
  return String(html)
    // Remove complete-document wrappers
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<html[^>]*>/gi, "")
    .replace(/<\/html>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<body[^>]*>/gi, "")
    .replace(/<\/body>/gi, "")

    // Remove tags commonly blocked by hosting firewalls
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*\/?>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<input[^>]*\/?>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<meta[^>]*\/?>/gi, "")
    .replace(/<link[^>]*\/?>/gi, "")

    // Remove event-handler attributes
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")

    // Remove javascript: URLs
    .replace(/javascript\s*:/gi, "")

    // Remove HTML comments generated inside source files
    // The WordPress <!--more--> tag is added afterward.
    .replace(/<!--[\s\S]*?-->/g, "")

    // Remove null/control characters, except tabs and line breaks
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "")

    .trim();
}

function formatTicketDate(dateStr) {
  if (!dateStr) return "";

  // Avoid timezone changing the ticket date.
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    const [, year, month, day] = match;
    return `${day}.${month}.${year}`;
  }

  const date = new Date(dateStr);

  if (Number.isNaN(date.getTime())) {
    return String(dateStr);
  }

  if (LANG === "en") {
    return date.toLocaleDateString("en-GB", {
      timeZone: "Europe/Bucharest",
    });
  }

  return date.toLocaleDateString("ro-RO", {
    timeZone: "Europe/Bucharest",
  });
}

function safeSelectionsCount(ticket) {
  return Array.isArray(ticket?.selections)
    ? ticket.selections.length
    : 0;
}

function safeProduct(ticket) {
  const product = ticket?.product;

  if (product === undefined || product === null || product === "") {
    return "-";
  }

  return product;
}

const I18N = {
  ro: {
    cota2_title: "Bilet Cota 2",
    zi_title: "Biletul Zilei",

    cota2_excerpt: (ticket) =>
      `Bilet Cota 2 cu ${safeSelectionsCount(
        ticket
      )} selecții • Cotă totală ${safeProduct(ticket)}`,

    zi_excerpt: (ticket) =>
      `Biletul Zilei cu ${safeSelectionsCount(
        ticket
      )} selecții • Cotă totală ${safeProduct(ticket)}`,

    ticket_date_label: "Data biletului",
  },

  en: {
    cota2_title: "Odds 2 Ticket",
    zi_title: "Bet of the Day",

    cota2_excerpt: (ticket) =>
      `Odds 2 Ticket with ${safeSelectionsCount(
        ticket
      )} selections • Total odds ${safeProduct(ticket)}`,

    zi_excerpt: (ticket) =>
      `Bet of the Day with ${safeSelectionsCount(
        ticket
      )} selections • Total odds ${safeProduct(ticket)}`,

    ticket_date_label: "Ticket date",
  },
};

const T = I18N[LANG] || I18N.ro;

function buildJsonBody(payload) {
  return JSON.stringify(payload);
}

function buildFormBody(payload) {
  const form = new URLSearchParams();

  form.set("title", payload.title);
  form.set("status", payload.status);
  form.set("content", payload.content);
  form.set("excerpt", payload.excerpt);

  for (const categoryId of payload.categories) {
    form.append("categories[]", String(categoryId));
  }

  return form.toString();
}

async function sendRequest(payload, requestType = "json") {
  const isJson = requestType === "json";

  const body = isJson
    ? buildJsonBody(payload)
    : buildFormBody(payload);

  console.log(
    `   Request format: ${
      isJson ? "application/json" : "application/x-www-form-urlencoded"
    }`
  );

  console.log(
    `   Request size: ${Buffer.byteLength(body, "utf8")} bytes`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(POSTS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": isJson
          ? "application/json; charset=utf-8"
          : "application/x-www-form-urlencoded; charset=utf-8",
        Accept: "application/json",
        "User-Agent": "PariuVerdePublisher/1.0",
      },
      body,
      signal: controller.signal,
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      server: response.headers.get("server") || "",
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isOpenRestyHtmlError(result) {
  const contentType = result.contentType.toLowerCase();
  const text = result.text.toLowerCase();
  const server = result.server.toLowerCase();

  return (
    result.status === 400 &&
    (
      contentType.includes("text/html") ||
      text.includes("<html") ||
      text.includes("openresty") ||
      server.includes("openresty")
    )
  );
}

function parseWordPressResponse(result) {
  try {
    return JSON.parse(result.text);
  } catch {
    return null;
  }
}

function showErrorResponse(title, result) {
  console.error(`❌ Publish failed "${title}"`);
  console.error(`   HTTP status: ${result.status} ${result.statusText}`);
  console.error(`   Content-Type: ${result.contentType || "unknown"}`);
  console.error(`   Server: ${result.server || "unknown"}`);
  console.error("   Response:");
  console.error(result.text.slice(0, 1500));
}

async function publish({
  title,
  html,
  excerpt,
  categorySlug,
  ticketDate,
}) {
  if (!html || !html.trim()) {
    console.log(`ℹ Empty content → skip "${title}"`);
    return {
      skipped: true,
      success: true,
    };
  }

  const cleanHtml = sanitizeHtmlFragment(html);
  const catId = CATEGORY_IDS[categorySlug] || null;

  if (!catId) {
    console.error(
      `❌ Category ID missing in local map: ${categorySlug}`
    );

    return {
      skipped: false,
      success: false,
    };
  }

  if (!cleanHtml) {
    console.error(
      `❌ Content became empty after sanitization: "${title}"`
    );

    return {
      skipped: false,
      success: false,
    };
  }

  const content = `
<p><strong>${excerpt}</strong></p>
<p><em>${T.ticket_date_label}: ${formatTicketDate(
    ticketDate
  )}</em></p>
<!--more-->
${cleanHtml}
`.trim();

  const payload = {
    title,
    status: "publish",
    content,
    excerpt,
    categories: [catId],
  };

  console.log("");
  console.log(`➡ Publishing: ${title}`);
  console.log(`   Endpoint: ${POSTS_ENDPOINT}`);
  console.log(`   Category slug: ${categorySlug}`);
  console.log(`   Category ID: ${catId}`);
  console.log(
    `   Clean HTML size: ${Buffer.byteLength(
      cleanHtml,
      "utf8"
    )} bytes`
  );

  let result;

  try {
    // Attempt 1: normal WordPress JSON REST request
    result = await sendRequest(payload, "json");
  } catch (error) {
    console.error(`❌ Network error publishing "${title}"`);
    console.error(error);

    return {
      skipped: false,
      success: false,
    };
  }

  // Some OpenResty/WAF configurations block JSON content based on HTML.
  // Retry using form-urlencoded, which WordPress REST also understands.
  if (!result.ok && isOpenRestyHtmlError(result)) {
    console.warn(
      `⚠ OpenResty returned HTML 400 for "${title}".`
    );
    console.warn(
      "⚠ Retrying with application/x-www-form-urlencoded..."
    );

    try {
      result = await sendRequest(payload, "form");
    } catch (error) {
      console.error(`❌ Retry network error for "${title}"`);
      console.error(error);

      return {
        skipped: false,
        success: false,
      };
    }
  }

  if (!result.ok) {
    showErrorResponse(title, result);

    const wordpressError = parseWordPressResponse(result);

    if (wordpressError?.code) {
      console.error(`   WordPress code: ${wordpressError.code}`);
    }

    if (wordpressError?.message) {
      console.error(
        `   WordPress message: ${wordpressError.message}`
      );
    }

    if (wordpressError?.data?.params) {
      console.error(
        `   Invalid parameters: ${JSON.stringify(
          wordpressError.data.params,
          null,
          2
        )}`
      );
    }

    return {
      skipped: false,
      success: false,
    };
  }

  const data = parseWordPressResponse(result);

  if (!data) {
    console.error(
      `❌ WordPress returned a successful HTTP status but invalid JSON for "${title}"`
    );
    console.error(result.text.slice(0, 1500));

    return {
      skipped: false,
      success: false,
    };
  }

  if (!data.id) {
    console.error(
      `❌ WordPress response does not contain a post ID for "${title}"`
    );
    console.error(JSON.stringify(data, null, 2).slice(0, 1500));

    return {
      skipped: false,
      success: false,
    };
  }

  console.log(`✅ Published post ID: ${data.id}`);

  if (data.link) {
    console.log(`✅ Published URL: ${data.link}`);
  } else {
    console.log(
      "⚠ WordPress created the post but did not return a link."
    );
  }

  return {
    skipped: false,
    success: true,
    id: data.id,
    link: data.link || null,
  };
}

async function main() {
  console.log(`WordPress endpoint: ${POSTS_ENDPOINT}`);
  console.log(`Language: ${LANG}`);

  const ticketsRaw = await read("tickets.json");

  if (!ticketsRaw) {
    throw new Error("tickets.json was not found or could not be read");
  }

  let tickets;

  try {
    tickets = JSON.parse(ticketsRaw);
  } catch (error) {
    throw new Error(
      `tickets.json contains invalid JSON: ${error.message}`
    );
  }

  if (tickets.status === "no_picks") {
    console.log("ℹ No picks today. Skip publish.");
    return;
  }

  const ticketDate = tickets.date;
  const ticketDateLabel = formatTicketDate(ticketDate);

  const cota2Html = await read("cota2.html");
  const ziHtml = await read("biletul-zilei.html");

  const results = [];

  if (cota2Html && tickets.bilet_cota2) {
    const result = await publish({
      title: `${T.cota2_title} (${ticketDateLabel})`,
      html: cota2Html,
      excerpt: T.cota2_excerpt(tickets.bilet_cota2),
      categorySlug: "cota-2",
      ticketDate,
    });

    results.push({
      ticket: "cota-2",
      ...result,
    });
  } else {
    console.log("ℹ No Cota 2 content to publish");
  }

  if (ziHtml && tickets.biletul_zilei) {
    const result = await publish({
      title: `${T.zi_title} (${ticketDateLabel})`,
      html: ziHtml,
      excerpt: T.zi_excerpt(tickets.biletul_zilei),
      categorySlug: "biletul-zilei",
      ticketDate,
    });

    results.push({
      ticket: "biletul-zilei",
      ...result,
    });
  } else {
    console.log("ℹ No Bet of the Day content to publish");
  }

  const failures = results.filter(
    (result) => result.success === false
  );

  console.log("");
  console.log("Publishing summary:");

  for (const result of results) {
    if (result.skipped) {
      console.log(`ℹ ${result.ticket}: skipped`);
    } else if (result.success) {
      console.log(
        `✅ ${result.ticket}: published${
          result.id ? `, post ID ${result.id}` : ""
        }`
      );
    } else {
      console.log(`❌ ${result.ticket}: failed`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} WordPress publication(s) failed`
    );
  }
}

main().catch((error) => {
  console.error("");
  console.error("❌ publish_wp.js failed");
  console.error(error);
  process.exit(1);
});
