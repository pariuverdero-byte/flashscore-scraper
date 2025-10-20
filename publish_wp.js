// publish_wp.js
import fs from "fs/promises";
import fetch from "node-fetch";

const { WP_URL, WP_USER, WP_APP_PASS } = process.env;
if(!WP_URL||!WP_USER||!WP_APP_PASS){ console.error("❌ Lipsesc WP_URL / WP_USER / WP_APP_PASS"); process.exit(1); }

const read = async(p)=> await fs.readFile(p,"utf8").catch(()=>null);
const auth = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASS}`).toString("base64");

async function catId(slug){
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/categories?slug=${slug}`, { headers:{ Authorization:auth }});
  const j = await r.json(); return j?.[0]?.id || null;
}
async function publish(title, html, slug){
  const id = await catId(slug);
  if(!id){ console.error(`❌ Categoria inexistentă: ${slug}`); return; }
  const body = { title, status:"publish", content: html, categories:[id] };
  const r = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
    method:"POST", headers:{ Authorization:auth, "Content-Type":"application/json" }, body: JSON.stringify(body)
  });
  if(!r.ok){ console.error("❌ Eroare publicare:", r.status, await r.text()); return; }
  const data = await r.json(); console.log(`✅ Publicat: ${data.link}`);
}

(async()=>{
  const today = new Date().toLocaleDateString("ro-RO");
  const c2 = await read("cota2.html");
  const zi = await read("biletul-zilei.html");

  if(c2) await publish(`Bilet Cota 2 (${today})`, c2, "cota-2");
  else console.log("ℹ cota2.html lipsă — nu public");

  if(zi) await publish(`Biletul Zilei (${today})`, zi, "biletul-zilei");
  else console.log("ℹ biletul-zilei.html lipsă — nu public");
})();
