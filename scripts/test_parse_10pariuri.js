import https from "https";
import { parse10PariuriCota2 } from "../parsers/parse10pariuri_cota2.js";

const URL =
  "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2-24012026/";

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      )
      .on("error", reject);
  });
}

async function run() {
  const html = await fetchHtml(URL);
  const parsed = parse10PariuriCota2(html, URL);

  console.log("==== PARSE RESULT ====");
  console.log(JSON.stringify(parsed, null, 2));
}

run().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
