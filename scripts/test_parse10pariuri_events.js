import fs from "fs";
import { parse10pariuriEvents } from "../parsers/parse10pariuri_events.js";

const html = fs.readFileSync("sample_10pariuri.html", "utf8");

const events = parse10pariuriEvents(
  html,
  "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2-24012026/"
);

console.log(events);
