// scrape_claudiu_full.js

import fs from "fs/promises";
import cheerio from "cheerio";

const DAY_OFFSET = Number(process.env.DAY_OFFSET || "0");

const MONTHS_RO = [
  "ianuarie","februarie","martie","aprilie","mai","iunie",
  "iulie","august","septembrie","octombrie","noiembrie","decembrie"
];

function getTargetDate(offset = 0) {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() + offset);
  return d;
}

function pad(n){ return String(n).padStart(2,"0"); }

function buildUrls(date){
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth()+1);
  const yyyy = date.getFullYear();
  const monthRo = MONTHS_RO[date.getMonth()];

  return {
    cota2: `https://www.claudiuhood.ro/cota-2-zilnica-${date.getDate()}-${monthRo}-${yyyy}/`,
    bilet: `https://www.claudiuhood.ro/biletul-zilei-${dd}-${mm}-${yyyy}/`,
    speciala: `https://www.claudiuhood.ro/variante-speciale-${date.getDate()}-${monthRo}-${yyyy}/`,
    rezerva: `https://www.claudiuhood.ro/varianta-rezerva-${dd}-${mm}-${yyyy}/`,
    islanda: `https://www.claudiuhood.ro/varianta-islanda-${date.getDate()}-${monthRo}-${yyyy}/`
  };
}

function clean(s=""){
  return s
    .replace(/\u00a0/g," ")
    .replace(/[–—]/g,"-")
    .replace(/\s+/g," ")
    .trim();
}

function extractOdd(text){
  const m = text.match(/cota\s*([0-9]+(?:[.,][0-9]+)?)/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function isValidMatch(t){
  return t.includes(" - ") && !/cota/i.test(t);
}

function slug(t){
  return t.toLowerCase().replace(/[^a-z0-9]+/g,"_");
}

function parseTables($, url, source){

  const selections = [];

  $("figure.wp-block-table table").each((_, table) => {

    $(table).find("tr").each((__, tr) => {

      const cells = $(tr).find("td").map((i,el)=>clean($(el).text())).get();

      if(cells.length < 3) return;

      const [teams, pick, oddText] = cells;
      const odd = extractOdd(oddText);

      if(!isValidMatch(teams)) return;
      if(!pick || !odd) return;

      selections.push({
        source,
        teams,
        pick,
        odd,
        match_id: slug(teams),
        url
      });

    });

  });

  return selections;
}

async function fetchPage(url){
  const res = await fetch(url,{
    headers:{
      "user-agent":"Mozilla/5.0"
    }
  });

  if(!res.ok) throw new Error(`HTTP ${res.status}`);

  return await res.text();
}

async function scrapeOne(url, source){
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const data = parseTables($, url, source);

  console.log(`✔ ${source}: ${data.length} picks`);

  return data;
}

function dedupe(arr){
  const map = new Map();

  arr.forEach(x=>{
    const key = x.match_id + "|" + x.pick + "|" + x.odd;
    map.set(key, x);
  });

  return [...map.values()];
}

async function main(){

  const date = getTargetDate(DAY_OFFSET);
  const urls = buildUrls(date);

  let all = [];

  for(const [key,url] of Object.entries(urls)){
    try{
      const data = await scrapeOne(url, key);
      all.push(...data);
    }catch(e){
      console.log(`❌ ${key} failed`);
    }
  }

  const final = dedupe(all);

  await fs.writeFile("claudiu_pool.json", JSON.stringify({
    date: date.toISOString().slice(0,10),
    total: final.length,
    selections: final
  }, null, 2));

  console.log("🔥 TOTAL:", final.length);
}

main();
