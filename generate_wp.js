// generate_wp.js (versiune completă, cu linkuri în <a target="_blank">)
import fs from "fs/promises";

const INPUT = "tickets.json";
const TODAY_OFFSET = Number(process.env.DAY_OFFSET || 0);
const RO_DATE = new Date(Date.now() + TODAY_OFFSET * 86400000)
  .toLocaleDateString("ro-RO", { year: "numeric", month: "long", day: "2-digit" });

const esc = (s="")=> String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const cap = (s)=> s ? s[0].toUpperCase()+s.slice(1) : s;

function niceSport(s){ const x=(s||"").toLowerCase();
  if(x==="football"||x==="fotbal") return "Fotbal";
  if(x==="tennis") return "Tenis";
  if(x==="basketball"||x==="basket") return "Baschet";
  return cap(s||"Fotbal"); }

function sportTara(e){ const sport=niceSport(e.sport||"Fotbal"); const comp=e.competition?` – ${e.competition}`:""; return `${sport}${comp}`; }
function marketLabel(m){ if(m==="1")return "1 (gazde)"; if(m==="X")return "X (egal)"; if(m==="2")return "2 (oaspeți)";
  if(m==="1X")return "1X (gazde sau egal)"; if(m==="12")return "12 (oricine câștigă)"; if(m==="X2")return "X2 (egal sau oaspeți)"; return m; }
const analysis = (s)=> `${s.teams} — selecție: ${marketLabel(s.market)} la cotă ${Number(s.odd).toFixed(2)}.` + (s.competition?` Competiție: ${s.competition}.`:"") + (s.time?` Ora de start (RO): ${s.time}.`:"") + (s.url?` Link meci: ${s.url}.`:"");

function tableHTML(title, selections, dateLabel){
  let html="";
  html+=`<!-- categorie: ${title.toLowerCase().includes("cota 2")?"cota 2":"biletul zilei"} -->\n`;
  html+=`<h2>${esc(title)}</h2>\n<p><em>${esc(dateLabel)}</em></p>\n`;
  html+=`<table class="bilet-pariu">\n<thead>\n<tr><th>Eveniment</th><th>Sport/Țară</th><th>Ora (RO)</th><th>Pariu propus</th><th>Cotă</th></tr>\n</thead>\n<tbody>\n`;
  let total=1;
  selections.forEach((s,i)=>{ 
    total*=Number(s.odd)||1; 
    const attr=i>=1?` data-status="pending"`:"";
    const ev = s.url 
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.teams)}</a>`
      : esc(s.teams);
    html+=`<tr${attr}>\n<td>${ev}</td>\n<td>${esc(s.sport?sportTara(s):sportTara({sport:"Fotbal", competition:s.competition}))}</td>\n<td>${esc(s.time||"")}</td>\n<td>${esc(marketLabel(s.market))}</td>\n<td>${Number(s.odd).toFixed(2)}</td>\n</tr>\n`; 
  });
  html+=`<tr class="total"><td colspan="4"><strong>Cotă totală</strong></td><td><strong>${total.toFixed(2)}</strong></td></tr>\n`;
  html+=`</tbody>\n</table>\n<h3>Analiza selecțiilor</h3>\n`;
  selections.forEach(s=>{ html+=`<p>${esc(analysis(s))}</p>\n`; });
  html+=`\n<p>[status_bilet]</p>\n`; 
  return html;
}

(async()=>{
  const raw=await fs.readFile(INPUT,"utf8").catch(()=>null);
  if(!raw){ console.error("Nu am găsit tickets.json"); process.exit(0); }
  const data=JSON.parse(raw);

  const c2 = data?.bilet_cota2?.selections || null;
  const zi = data?.biletul_zilei?.selections || null;

  if(c2?.length){ await fs.writeFile("cota2.html", tableHTML("Bilet Cota 2", c2, `Data: ${RO_DATE}`), "utf8"); console.log("✔ cota2.html generat"); }
  else console.log("ℹ Nu există Bilet Cota 2");

  if(zi?.length){ await fs.writeFile("biletul-zilei.html", tableHTML("Biletul Zilei", zi, `Data: ${RO_DATE}`), "utf8"); console.log("✔ biletul-zilei.html generat"); }
  else console.log("ℹ Nu există Biletul Zilei");
})();
