// FIX pentru undici / axios
global.File = class File {};

import axios from "axios";
import { parse10PariuriCota2 } from "../parsers/parse10pariuri_cota2.js";

const URL =
  "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2-24012026/";

async function run() {
  const res = await axios.get(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  const parsed = parse10PariuriCota2(res.data, URL);

  console.log("==== PARSE RESULT ====");
  console.log(JSON.stringify(parsed, null, 2));
}

run().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
