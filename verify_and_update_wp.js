// verify_and_update_wp.js
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
if(!WP_URL||!WP_USER||!WP_APP_PASS){ 
  console.error("❌ Lipsesc WP_URL / WP_USER / WP_APP_PASS"); 
  process.exit(1); 
}

const AUTH = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");
const MAX_POSTS_PER_CAT = Number(process.env.MAX_POSTS_PER_CAT || 6);

async function getCategoryId(slug){
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/categories?slug=${slug}`, { headers:{ Authorization: AUTH }});
  const j = await r.json(); 
  return j?.[0]?.id || null;
}
async function listPostsByCategory(catId, perPage=6){
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts?categories=${catId}&per_page=${perPage}&orderby=date&order=desc`, {
    headers:{ Authorization: AUTH }
  });
  if(!r.ok){ 
    console.error("❌ list posts err:", r.status, await r.text());
    return [];
  }
  return await r.json();
}
async function updatePost(postId, newContent){
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "PUT",
    headers: { Authorization: AUTH, "Content-Type":"application/json" },
    body: JSON.stringify({ content: newContent })
  });
  if(!r.ok){
    console.error(`❌ update post ${postId} err:`, r.status, await r.text());
    return false;
  }
  console.log(`✅ Actualizat post #${postId}`);
  return true;
}

// --- Helpers pentru rezultat ---
function parseMarketLabel(text){
  const t = (text||"").toUpperCase();
  if(t.startsWith("1 ")) return "1";
  if(t === "1" || t.includes("(GAZDE)")) return "1";
  if(t.startsWith("X ")) return "X";
  if(t === "X" || t.includes("(EGAL)")) return "X";
  if(t.startsWith("2 ")) return "2";
  if(t === "2" || t.includes("(OASP"))) return "2";
  // extinderi viitoare: 1X/12/X2 etc.
  return null;
}

function decideOutcomeFromScore(home, away){
  if(home > away) return "1";
  if(home < away) return "2";
  return "X";
}

async function fetchMatchOutcome(url){
  // ia textul paginii și decide: finished? scor?
  try{
    const r = await fetch(url, { headers:{ "User-Agent":"Mozilla/5.0", "Accept-Language":"ro,en;q=0.9" }});
    if(!r.ok) return { status:"pending" };
    const html = await r.text();
    const $ = cheerio.load(html);
    const bodyText = $("body").text();
    // dacă nu e terminate, nu atingem rândul
    if(!/Finished|FT\b/i.test(bodyText)) return { status:"pending" };

    // caută primul scor A:B rezonabil
    const m = bodyText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if(!m) return { status:"pending" };
    const home = parseInt(m[1],10), away = parseInt(m[2],10);
    const outcome = decideOutcomeFromScore(home, away);
    return { status:"finished", outcome, score:`${home}:${away}` };
  }catch(e){
    return { status:"pending" };
  }
}

function updateTableStatuses(html){
  const $ = cheerio.load(html);
  const table = $("table.bilet-pariu").first();
  if(!table.length) return { html, changed:false };

  const rows = table.find("tbody > tr").toArray();
  let changed = false;

  for(const tr of rows){
    const $tr = $(tr);
    if($tr.hasClass("total")) continue; // ultimul rând cu cota totală
    const tds = $tr.find("td");
    if(tds.length < 4) continue;

    // col 0 = eveniment, conține <a href="...">
    const a = $(tds[0]).find("a").first();
    const url = a.attr("href");

    // col 3 = pariu propus
    const pickText = $(tds[3]).text().trim();
    const pick = parseMarketLabel(pickText);
    if(!url || !pick) continue;

    $tr.attr("data-status", $tr.attr("data-status") || "pending"); // default

    // vom rezolva sincron în serie (simplu, sigur)
    // (notă: dacă vrei mai rapid, poți lansa în paralel; aici păstrăm claritatea)
  }

  return { $, table, rows, changed };
}

async function verifyAndMutate(html){
  const parsed = updateTableStatuses(html);
  if(!parsed.$) return { html, changed:false };

  const { $, rows } = parsed;
  let changed = false;

  for(const tr of rows){
    const $tr = $(tr);
    if($tr.hasClass("total")) continue;
    const tds = $tr.find("td");
    if(tds.length < 4) continue;

    const a = $(tds[0]).find("a").first();
    const url = a.attr("href");
    const pick = parseMarketLabel($(tds[3]).text().trim());
    if(!url || !pick) continue;

    const current = ($tr.attr("data-status")||"").toLowerCase();
    if(current === "win" || current === "loss") continue; // deja setat

    const res = await fetchMatchOutcome(url);
    if(res.status === "finished"){
      const win = (res.outcome === pick);
      $tr.attr("data-status", win ? "win" : "loss");
      changed = true;
    } else {
      // încă pending — nu modificăm
    }
  }

  return { html: $.html(), changed };
}

async function processCategory(slug){
  const catId = await getCategoryId(slug);
  if(!catId){ console.error(`❌ Categoria lipsă: ${slug}`); return; }
  const posts = await listPostsByCategory(catId, MAX_POSTS_PER_CAT);
  for(const p of posts){
    const content = p?.content?.rendered || "";
    const { html:newHtml, changed } = await verifyAndMutate(content);
    if(changed){
      await updatePost(p.id, newHtml);
    } else {
      console.log(`ℹ Nicio schimbare pentru post #${p.id}`);
    }
  }
}

(async()=>{
  await processCategory("cota-2");
  await processCategory("biletul-zilei");
})();
