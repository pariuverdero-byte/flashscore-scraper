import parse10pariuriGeneric from "../parsers/parse10pariuri_generic.js";
import { flashscoreMapMatch } from "../engine/flashscore_mapper.js";

/**
 * Rulează cu:
 * node --require ./scripts/undici_shim.cjs scripts/test_parse_10pariuri_multi.js
 */

const SOURCES = [
  {
    label: "TENIS_AZI",
    url: "https://10pariuri.ro/ponturi-pariuri-azi/tenis-24-01-2026/",
  },
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
  {
    label: "PONTUL_ZILEI",
    url: "https://10pariuri.ro/pontul-zilei/pontul-zilei-24012026/",
  },
];

async functi
