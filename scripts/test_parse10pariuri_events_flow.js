import { parse10pariuriEvents } from "../parsers/parse10pariuri_events.js";

const SOURCES = [
  {
    label: "COTA2",
    url: "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-2-24012026/",
  },
  {
    label: "COTA3",
    url: "https://10pariuri.ro/biletul-zilei-la-pariuri/fotbal-cota-3-24012026/",
  },
  {
    label: "COTA_MARE",
    url: "https://10pariuri.ro/biletul-zilei-la-pariuri/cota-mare-24012026/",
  },
  {
    label: "BAN_PE_BAN",
    url: "https://10pariuri.ro/biletul-zilei-la-pariuri/bilet-fotbal-ban-pe-ban-ion-dan-24012026/",
  },
];

async function run() {
  let totalEvents = 0;

  for (const src of SOURCES) {
    console.log("\n==============================");
    console.log("SOURCE:", src.label);

    const events = await parse10pariuriEvents(src.url);

    console.log(`→ ${events.length} events extracted`);
    totalEvents += events.length;

    events.forEach((e, idx) => {
      console.log(
        `${idx + 1}. ${e.home} vs ${e.away} | ${e.market} | cota ${e.odd}`
      );
    });
  }

  console.log("\n==============================");
  console.log("TOTAL EVENTS:", totalEvents);
}

run().catch(err => {
  console.error("❌ TEST FAILED", err);
  process.exit(1);
});
