import fs from "fs/promises";
import path from "path";

/*
 * =========================================================
 * INPUT / OUTPUT
 * =========================================================
 */

const INPUT_FILE =
  process.env.SHORTS_INPUT_FILE ||
  "tickets.json";

const OUTPUT_DIR =
  process.env.SHORTS_OUTPUT_DIR ||
  "output";

const TICKET_TYPE =
  process.env.SHORTS_TICKET_TYPE ||
  "bilet_cota2";

const LANG =
  String(
    process.env.LANG ||
    "en"
  )
    .trim()
    .toLowerCase();

/*
 * =========================================================
 * BRAND CONFIGURATION
 * =========================================================
 */

const DEFAULT_BRAND =
  LANG === "ro"
    ? {
        name: "PariuVerde",
        displayName: "PARIUVERDE",
        website: "pariuverde.ro",
        websiteDisplay: "WWW.PARIUVERDE.RO",
        url: "https://pariuverde.ro"
      }
    : {
        name: "GreenBetTips",
        displayName: "GREENBETTIPS",
        website: "greenbettips.com",
        websiteDisplay: "WWW.GREENBETTIPS.COM",
        url: "https://greenbettips.com"
      };

const BRAND_NAME =
  process.env.SHORTS_BRAND_NAME ||
  DEFAULT_BRAND.name;

const BRAND_DISPLAY =
  process.env.SHORTS_BRAND_DISPLAY ||
  DEFAULT_BRAND.displayName;

const SITE_URL =
  (
    process.env.SHORTS_SITE_URL ||
    DEFAULT_BRAND.url
  ).replace(/\/$/, "");

const WEBSITE =
  process.env.SHORTS_WEBSITE ||
  DEFAULT_BRAND.website;

const WEBSITE_DISPLAY =
  process.env.SHORTS_WEBSITE_DISPLAY ||
  DEFAULT_BRAND.websiteDisplay;

/*
 * =========================================================
 * BACKGROUND CONFIGURATION
 * =========================================================
 *
 * Fișierele trebuie să existe în repository.
 *
 * Poți suprascrie lista din workflow:
 *
 * SHORTS_BACKGROUND_FILES:
 * assets/backgrounds/bg01.mp4,assets/backgrounds/bg02.mp4
 *
 * Schimbarea efectivă trebuie implementată și în render_short.js.
 */

const DEFAULT_BACKGROUND_FILES =
  LANG === "ro"
    ? [
        "assets/backgrounds/ro/background_01.mp4",
        "assets/backgrounds/ro/background_02.mp4",
        "assets/backgrounds/ro/background_03.mp4",
        "assets/backgrounds/ro/background_04.mp4",
        "assets/backgrounds/ro/background_05.mp4"
      ]
    : [
        "assets/backgrounds/en/background_01.mp4",
        "assets/backgrounds/en/background_02.mp4",
        "assets/backgrounds/en/background_03.mp4",
        "assets/backgrounds/en/background_04.mp4",
        "assets/backgrounds/en/background_05.mp4"
      ];

const BACKGROUND_FILES =
  String(
    process.env.SHORTS_BACKGROUND_FILES ||
    ""
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const AVAILABLE_BACKGROUNDS =
  BACKGROUND_FILES.length > 0
    ? BACKGROUND_FILES
    : DEFAULT_BACKGROUND_FILES;

const BACKGROUND_CHANGE_MIN_SECONDS =
  readNumberEnv(
    "SHORTS_BACKGROUND_CHANGE_MIN_SECONDS",
    4
  );

const BACKGROUND_CHANGE_MAX_SECONDS =
  readNumberEnv(
    "SHORTS_BACKGROUND_CHANGE_MAX_SECONDS",
    7
  );

/*
 * =========================================================
 * LANGUAGE LABELS
 * =========================================================
 */

const LABELS = {
  en: {
    ticketLabels: {
      bilet_cota2: "Odds 2 Ticket",
      biletul_zilei: "Bet of the Day"
    },

    visualHeadlines: {
      bilet_cota2: "ODDS 2 TICKET",
      biletul_zilei: "BET OF THE DAY"
    },

    visualCombinedOdds:
      "COMBINED ODDS",

    visualWebsite:
      WEBSITE_DISPLAY,

    visualOutroTop:
      "ENJOYED TODAY'S PICKS?",

    visualSubscribe:
      "SUBSCRIBE",

    visualOutroMessage:
      "FOR DAILY FOOTBALL PREDICTIONS",

    noTicket:
      "No suitable ticket is available for a Short today.",

    hashtags: [
      "football",
      "footballpredictions",
      "bettingtips",
      "soccer",
      "shorts"
    ]
  },

  ro: {
    ticketLabels: {
      bilet_cota2: "Bilet Cota 2",
      biletul_zilei: "Biletul Zilei"
    },

    visualHeadlines: {
      bilet_cota2: "BILET COTA 2",
      biletul_zilei: "BILETUL ZILEI"
    },

    visualCombinedOdds:
      "COTA TOTALĂ",

    visualWebsite:
      WEBSITE_DISPLAY,

    visualOutroTop:
      "ȚI-AU PLĂCUT PONTURILE?",

    visualSubscribe:
      "ABONEAZĂ-TE",

    visualOutroMessage:
      "PENTRU PONTURI ZILNICE",

    noTicket:
      "Astăzi nu există un bilet potrivit pentru videoclip.",

    hashtags: [
      "pariuri",
      "ponturi",
      "fotbal",
      "pronosticuri",
      "biletulzilei",
      "shorts"
    ]
  }
};

const T =
  LABELS[LANG] ||
  LABELS.en;

/*
 * =========================================================
 * RANDOMIZATION
 * =========================================================
 */

function hashString(value) {
  let hash = 2166136261;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^= value.charCodeAt(index);

    hash = Math.imul(
      hash,
      16777619
    );
  }

  return hash >>> 0;
}

function createSeededRandom(seedValue) {
  let state =
    hashString(
      String(seedValue)
    ) || 1;

  return function random() {
    state += 0x6d2b79f5;

    let result = state;

    result = Math.imul(
      result ^ (result >>> 15),
      result | 1
    );

    result ^=
      result +
      Math.imul(
        result ^ (result >>> 7),
        result | 61
      );

    return (
      (
        result ^
        (result >>> 14)
      ) >>> 0
    ) / 4294967296;
  };
}

function randomInteger(
  random,
  min,
  max
) {
  const safeMin =
    Math.ceil(
      Math.min(min, max)
    );

  const safeMax =
    Math.floor(
      Math.max(min, max)
    );

  return (
    Math.floor(
      random() *
      (
        safeMax -
        safeMin +
        1
      )
    ) +
    safeMin
  );
}

function randomDecimal(
  random,
  min,
  max,
  decimals = 2
) {
  const value =
    min +
    random() *
    (max - min);

  return Number(
    value.toFixed(decimals)
  );
}

function pickRandom(
  array,
  random
) {
  if (
    !Array.isArray(array) ||
    array.length === 0
  ) {
    return "";
  }

  return array[
    randomInteger(
      random,
      0,
      array.length - 1
    )
  ];
}

function shuffle(
  array,
  random
) {
  const result =
    [...array];

  for (
    let index =
      result.length - 1;
    index > 0;
    index -= 1
  ) {
    const target =
      randomInteger(
        random,
        0,
        index
      );

    [
      result[index],
      result[target]
    ] = [
      result[target],
      result[index]
    ];
  }

  return result;
}

/*
 * =========================================================
 * GENERAL HELPERS
 * =========================================================
 */

function readNumberEnv(
  name,
  fallback
) {
  const value =
    Number(
      process.env[name]
    );

  return Number.isFinite(value)
    ? value
    : fallback;
}

function clean(value) {
  return String(
    value ?? ""
  )
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRomanianText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș/g, "s")
    .replace(/ş/g, "s")
    .replace(/ț/g, "t")
    .replace(/ţ/g, "t");
}

function capitalizeFirst(value) {
  const text =
    clean(value);

  if (!text) {
    return "";
  }

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
}

function displayOdd(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number.toFixed(2)
    : clean(value);
}

/*
 * =========================================================
 * NUMBER PRONUNCIATION
 * =========================================================
 */

const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
];

const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety"
];

const RO_UNITS = [
  "zero",
  "unu",
  "doi",
  "trei",
  "patru",
  "cinci",
  "șase",
  "șapte",
  "opt",
  "nouă",
  "zece",
  "unsprezece",
  "douăsprezece",
  "treisprezece",
  "paisprezece",
  "cincisprezece",
  "șaisprezece",
  "șaptesprezece",
  "optsprezece",
  "nouăsprezece"
];

const RO_TENS = [
  "",
  "",
  "douăzeci",
  "treizeci",
  "patruzeci",
  "cincizeci",
  "șaizeci",
  "șaptezeci",
  "optzeci",
  "nouăzeci"
];

function integerToEnglish(
  value
) {
  const number =
    Math.trunc(
      Number(value)
    );

  if (
    !Number.isFinite(number)
  ) {
    return clean(value);
  }

  if (number < 0) {
    return `minus ${integerToEnglish(
      Math.abs(number)
    )}`;
  }

  if (number < 20) {
    return EN_UNITS[number];
  }

  if (number < 100) {
    const tens =
      Math.floor(
        number / 10
      );

    const unit =
      number % 10;

    return unit === 0
      ? EN_TENS[tens]
      : `${EN_TENS[tens]} ${EN_UNITS[unit]}`;
  }

  if (number < 1000) {
    const hundreds =
      Math.floor(
        number / 100
      );

    const remainder =
      number % 100;

    return remainder === 0
      ? `${EN_UNITS[hundreds]} hundred`
      : `${EN_UNITS[hundreds]} hundred and ${integerToEnglish(
          remainder
        )}`;
  }

  return String(number)
    .split("")
    .map(
      (digit) =>
        EN_UNITS[
          Number(digit)
        ]
    )
    .join(" ");
}

function integerToRomanian(
  value
) {
  const number =
    Math.trunc(
      Number(value)
    );

  if (
    !Number.isFinite(number)
  ) {
    return clean(value);
  }

  if (number < 0) {
    return `minus ${integerToRomanian(
      Math.abs(number)
    )}`;
  }

  if (number < 20) {
    return RO_UNITS[number];
  }

  if (number < 100) {
    const tens =
      Math.floor(
        number / 10
      );

    const unit =
      number % 10;

    return unit === 0
      ? RO_TENS[tens]
      : `${RO_TENS[tens]} și ${RO_UNITS[unit]}`;
  }

  if (number < 200) {
    const remainder =
      number - 100;

    return remainder === 0
      ? "o sută"
      : `o sută ${integerToRomanian(
          remainder
        )}`;
  }

  if (number < 1000) {
    const hundreds =
      Math.floor(
        number / 100
      );

    const remainder =
      number % 100;

    const prefix =
      `${RO_UNITS[hundreds]} sute`;

    return remainder === 0
      ? prefix
      : `${prefix} ${integerToRomanian(
          remainder
        )}`;
  }

  return String(number)
    .split("")
    .map(
      (digit) =>
        RO_UNITS[
          Number(digit)
        ]
    )
    .join(" ");
}

function spokenOdd(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return clean(value);
  }

  const fixed =
    number.toFixed(2);

  const [
    integerPart,
    decimalPart
  ] = fixed.split(".");

  if (LANG === "ro") {
    return (
      `${integerToRomanian(
        Number(integerPart)
      )} virgulă ` +
      decimalPart
        .split("")
        .map(
          (digit) =>
            RO_UNITS[
              Number(digit)
            ]
        )
        .join(" ")
    );
  }

  return (
    `${integerToEnglish(
      Number(integerPart)
    )} point ` +
    decimalPart
      .split("")
      .map(
        (digit) =>
          EN_UNITS[
            Number(digit)
          ]
      )
      .join(" ")
  );
}

function spokenPickNumber(
  index
) {
  if (LANG === "ro") {
    const labels = {
      1: "Prima selecție",
      2: "A doua selecție",
      3: "A treia selecție",
      4: "A patra selecție",
      5: "A cincea selecție",
      6: "A șasea selecție"
    };

    return (
      labels[index] ||
      `Selecția numărul ${integerToRomanian(
        index
      )}`
    );
  }

  const labels = {
    1: "First pick",
    2: "Second pick",
    3: "Third pick",
    4: "Fourth pick",
    5: "Fifth pick",
    6: "Sixth pick"
  };

  return (
    labels[index] ||
    `Pick number ${integerToEnglish(
      index
    )}`
  );
}

/*
 * =========================================================
 * MARKET TRANSLATION
 * =========================================================
 */

function translateMarketToEnglish(value) {
  const original =
    clean(value);

  if (!original) {
    return "";
  }

  const normalized =
    normalizeRomanianText(
      original
    );

  const exactTranslations = {
    "victorie gazde":
      "Home Win",

    "victorie oaspeti":
      "Away Win",

    "egal":
      "Draw",

    "1x":
      "Home Win or Draw",

    "x2":
      "Away Win or Draw",

    "12":
      "Either Team to Win",

    "peste 0.5 goluri":
      "Over 0.5 Goals",

    "peste 1.5 goluri":
      "Over 1.5 Goals",

    "peste 2.5 goluri":
      "Over 2.5 Goals",

    "peste 3.5 goluri":
      "Over 3.5 Goals",

    "peste 4.5 goluri":
      "Over 4.5 Goals",

    "peste 5.5 goluri":
      "Over 5.5 Goals",

    "sub 0.5 goluri":
      "Under 0.5 Goals",

    "sub 1.5 goluri":
      "Under 1.5 Goals",

    "sub 2.5 goluri":
      "Under 2.5 Goals",

    "sub 3.5 goluri":
      "Under 3.5 Goals",

    "sub 4.5 goluri":
      "Under 4.5 Goals",

    "sub 5.5 goluri":
      "Under 5.5 Goals",

    "ambele echipe marcheaza":
      "Both Teams to Score",

    "ambele echipe marcheaza - da":
      "Both Teams to Score",

    "ambele echipe marcheaza da":
      "Both Teams to Score",

    "ambele echipe inscriu":
      "Both Teams to Score",

    "gg":
      "Both Teams to Score",

    "ambele echipe marcheaza - nu":
      "Both Teams Not to Score",

    "ambele echipe marcheaza nu":
      "Both Teams Not to Score",

    "ng":
      "Both Teams Not to Score",

    "gazde peste 0.5 goluri":
      "Home Team Over 0.5 Goals",

    "gazde peste 1.5 goluri":
      "Home Team Over 1.5 Goals",

    "gazde peste 2.5 goluri":
      "Home Team Over 2.5 Goals",

    "oaspeti peste 0.5 goluri":
      "Away Team Over 0.5 Goals",

    "oaspeti peste 1.5 goluri":
      "Away Team Over 1.5 Goals",

    "oaspeti peste 2.5 goluri":
      "Away Team Over 2.5 Goals",

    "gazde marcheaza":
      "Home Team to Score",

    "oaspeti marcheaza":
      "Away Team to Score",

    "gazde castiga oricare repriza":
      "Home Team to Win Either Half",

    "oaspeti castiga oricare repriza":
      "Away Team to Win Either Half",

    "peste 0.5 goluri prima repriza":
      "Over 0.5 First-Half Goals",

    "peste 1.5 goluri prima repriza":
      "Over 1.5 First-Half Goals",

    "sub 1.5 goluri prima repriza":
      "Under 1.5 First-Half Goals"
  };

  if (
    exactTranslations[normalized]
  ) {
    return exactTranslations[
      normalized
    ];
  }

  const dynamicPatterns = [
    {
      regex:
        /^peste (\d+(?:\.\d+)?) goluri$/,

      format:
        (number) =>
          `Over ${number} Goals`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) goluri$/,

      format:
        (number) =>
          `Under ${number} Goals`
    },
    {
      regex:
        /^peste (\d+(?:\.\d+)?) cornere$/,

      format:
        (number) =>
          `Over ${number} Corners`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) cornere$/,

      format:
        (number) =>
          `Under ${number} Corners`
    },
    {
      regex:
        /^peste (\d+(?:\.\d+)?) cartonase$/,

      format:
        (number) =>
          `Over ${number} Cards`
    },
    {
      regex:
        /^sub (\d+(?:\.\d+)?) cartonase$/,

      format:
        (number) =>
          `Under ${number} Cards`
    }
  ];

  for (
    const pattern of dynamicPatterns
  ) {
    const match =
      normalized.match(
        pattern.regex
      );

    if (match) {
      return pattern.format(
        match[1]
      );
    }
  }

  console.warn(
    `[SHORTS] Untranslated market: ${original}`
  );

  return original;
}

function localizeMarket(value) {
  const original =
    clean(value);

  return LANG === "en"
    ? translateMarketToEnglish(
        original
      )
    : original;
}

/*
 * =========================================================
 * SPOKEN MARKET
 * =========================================================
 */

function replaceNumbersForSpeech(
  value
) {
  let result =
    clean(value);

  result =
    result.replace(
      /\b(\d+)\.(\d+)\b/g,
      (
        full,
        integerPart,
        decimalPart
      ) => {
        if (LANG === "ro") {
          if (
            decimalPart === "5"
          ) {
            return (
              `${integerToRomanian(
                Number(integerPart)
              )} și jumătate`
            );
          }

          return (
            `${integerToRomanian(
              Number(integerPart)
            )} virgulă ` +
            decimalPart
              .split("")
              .map(
                (digit) =>
                  RO_UNITS[
                    Number(digit)
                  ]
              )
              .join(" ")
          );
        }

        return (
          `${integerToEnglish(
            Number(integerPart)
          )} point ` +
          decimalPart
            .split("")
            .map(
              (digit) =>
                EN_UNITS[
                  Number(digit)
                ]
            )
            .join(" ")
        );
      }
    );

  result =
    result.replace(
      /\b\d+\b/g,
      (numberText) =>
        LANG === "ro"
          ? integerToRomanian(
              Number(numberText)
            )
          : integerToEnglish(
              Number(numberText)
            )
    );

  return result;
}

function naturalRomanianMarket(
  value
) {
  const normalized =
    normalizeRomanianText(
      value
    );

  const exact = {
    "peste 0.5 goluri":
      "cel puțin un gol",

    "peste 1.5 goluri":
      "peste un gol și jumătate",

    "peste 2.5 goluri":
      "peste două goluri și jumătate",

    "peste 3.5 goluri":
      "peste trei goluri și jumătate",

    "peste 4.5 goluri":
      "peste patru goluri și jumătate",

    "sub 1.5 goluri":
      "sub un gol și jumătate",

    "sub 2.5 goluri":
      "sub două goluri și jumătate",

    "sub 3.5 goluri":
      "sub trei goluri și jumătate",

    "ambele echipe marcheaza":
      "ambele echipe marchează",

    "ambele echipe marcheaza - da":
      "ambele echipe marchează",

    "ambele echipe marcheaza da":
      "ambele echipe marchează",

    "ambele echipe inscriu":
      "ambele echipe marchează",

    "gg":
      "ambele echipe marchează",

    "ambele echipe marcheaza - nu":
      "nu marchează ambele echipe",

    "ambele echipe marcheaza nu":
      "nu marchează ambele echipe",

    "ng":
      "nu marchează ambele echipe",

    "victorie gazde":
      "victoria echipei gazdă",

    "victorie oaspeti":
      "victoria echipei oaspete",

    "egal":
      "rezultat de egalitate",

    "1x":
      "unu X, gazdele nu pierd",

    "x2":
      "X doi, oaspeții nu pierd",

    "12":
      "fără rezultat de egalitate"
  };

  if (exact[normalized]) {
    return exact[normalized];
  }

  return replaceNumbersForSpeech(
    value
  );
}

function naturalEnglishMarket(
  value
) {
  return replaceNumbersForSpeech(
    value
  );
}

function spokenMarket(value) {
  return LANG === "ro"
    ? naturalRomanianMarket(
        value
      )
    : naturalEnglishMarket(
        value
      );
}

/*
 * =========================================================
 * TEAM / SELECTION HELPERS
 * =========================================================
 */

function splitTeams(selection) {
  const home =
    clean(selection.home);

  const away =
    clean(selection.away);

  if (home || away) {
    return {
      home,
      away,

      teams:
        clean(
          selection.teams ||
          [home, away]
            .filter(Boolean)
            .join(" - ")
        )
    };
  }

  const teams =
    clean(selection.teams);

  const parts =
    teams.split(
      /\s+-\s+/
    );

  return {
    home:
      clean(parts[0]),

    away:
      clean(
        parts
          .slice(1)
          .join(" - ")
      ),

    teams
  };
}

function selectionToPayload(
  selection,
  index
) {
  const teamData =
    splitTeams(selection);

  const marketOriginal =
    clean(
      (LANG === "en" ? selection.ai?.label_en : selection.ai?.label_ro) ||
      selection.market_raw ||
      selection.bet_text_ro ||
      selection.market ||
      selection.bet_text_en
    );

  const market =
    localizeMarket(
      marketOriginal
    );

  return {
    index:
      index + 1,

    matchId:
      clean(
        selection.match_id ||
        selection.matchId
      ),

    teams:
      teamData.teams,

    home:
      teamData.home,

    away:
      teamData.away,

    competition:
      clean(
        selection.competition
      ),

    country:
      clean(
        selection.country
      ),

    kickoff:
      clean(
        selection.start_time ||
        selection.kickoff
      ),

    marketOriginal,

    market,

    spokenMarket:
      spokenMarket(
        market
      ),

    odds:
      displayOdd(
        selection.odd ??
        selection.odds
      ),

    spokenOdds:
      spokenOdd(
        selection.odd ??
        selection.odds
      ),

    source:
      clean(
        selection.source
      ),

    url:
      clean(
        selection.flashscore_url ||
        selection.flashscoreUrl ||
        selection.url
      )
  };
}

/*
 * =========================================================
 * TICKET LABELS
 * =========================================================
 */

function ticketLabel(type) {
  return (
    T.ticketLabels[type] ||
    clean(type)
  );
}

function visualHeadline(type) {
  return (
    T.visualHeadlines[type] ||
    ticketLabel(type).toUpperCase()
  );
}

/*
 * =========================================================
 * NATURAL VOICE SCRIPT
 * =========================================================
 */

function getVoicePhrases(
  random
) {
  if (LANG === "ro") {
    return {
      intros: {
        bilet_cota2: [
          "Salut! Iată biletul cota doi de astăzi.",
          "Hai să vedem selecțiile pentru biletul cota doi.",
          "Biletul cota doi de astăzi este pregătit.",
          "Avem pregătit biletul cota doi pentru astăzi.",
          "Acestea sunt selecțiile noastre pentru biletul cota doi."
        ],

        biletul_zilei: [
          "Salut! Iată biletul zilei.",
          "Hai să vedem selecțiile de astăzi.",
          "Biletul zilei este pregătit.",
          "Am pregătit pronosticurile zilei.",
          "Acestea sunt selecțiile noastre pentru astăzi."
        ]
      },

      transitions: [
        "Mergem mai departe.",
        "Următorul meci.",
        "Continuăm.",
        "Mai departe.",
        "Următoarea selecție."
      ],

      selectionLeadIns: [
        "Pronosticul nostru este",
        "Alegerea noastră este",
        "Mergem pe",
        "Selecția recomandată este",
        "Pentru acest meci alegem"
      ],

      oddsLeadIns: [
        "Cota este",
        "Avem cota",
        "La cota",
        "Selecția are cota"
      ],

      totalOdds: [
        "Cota totală a biletului este",
        "În total, biletul are cota",
        "Cota finală este",
        "Biletul ajunge la cota"
      ],

      outros: [
        `Găsești biletul complet pe ${WEBSITE}. Succes!`,
        `Vezi toate detaliile pe ${WEBSITE}. Mult succes!`,
        `Biletul complet este pe ${WEBSITE}. Joacă responsabil!`,
        `Intră pe ${WEBSITE} pentru toate detaliile. Succes!`,
        `Urmărește-ne pentru ponturile următoare. Mult succes!`
      ],

      brandMentions: [
        `de la ${BRAND_NAME}`,
        `pregătit de ${BRAND_NAME}`,
        `din partea ${BRAND_NAME}`
      ]
    };
  }

  return {
    intros: {
      bilet_cota2: [
        "Here are today's Odds Two football picks.",
        "Let's check today's Odds Two ticket.",
        "Today's Odds Two ticket is ready.",
        "Here are our selections for today's Odds Two ticket.",
        "Let's get into today's football picks."
      ],

      biletul_zilei: [
        "Here is today's Bet of the Day.",
        "Let's check today's football selections.",
        "Today's football ticket is ready.",
        "Here are our picks for today.",
        "Let's get into today's football predictions."
      ]
    },

    transitions: [
      "Moving on.",
      "Next match.",
      "Up next.",
      "Let's continue.",
      "The next pick."
    ],

    selectionLeadIns: [
      "Our pick is",
      "We're going with",
      "The selection is",
      "Our prediction is",
      "For this match, we like"
    ],

    oddsLeadIns: [
      "The odds are",
      "At odds of",
      "This pick is priced at",
      "The selection comes at"
    ],

    totalOdds: [
      "The combined odds are",
      "The full ticket comes to",
      "The total odds are",
      "Together, the selections give us"
    ],

    outros: [
      `Find the full ticket on ${WEBSITE}. Good luck!`,
      `Visit ${WEBSITE} for all the details. Good luck!`,
      `The complete ticket is available on ${WEBSITE}.`,
      `Follow for more daily football picks. Good luck!`,
      `Check ${WEBSITE} for the full ticket. Bet responsibly.`
    ],

    brandMentions: [
      `from ${BRAND_NAME}`,
      `prepared by ${BRAND_NAME}`,
      `brought to you by ${BRAND_NAME}`
    ]
  };
}

function buildTeamsVoiceLine(
  match
) {
  if (
    match.home &&
    match.away
  ) {
    return LANG === "ro"
      ? `${match.home}, contra ${match.away}.`
      : `${match.home}, against ${match.away}.`;
  }

  return `${match.teams}.`;
}

function buildVoiceScript(
  matches,
  totalOdds,
  random
) {
  const phrases =
    getVoicePhrases(random);

  const introOptions =
    phrases.intros[
      TICKET_TYPE
    ] ||
    phrases.intros.biletul_zilei;

  const lines = [];

  const intro =
    pickRandom(
      introOptions,
      random
    );

  const mentionBrand =
    random() >= 0.45;

  lines.push(
    capitalizeFirst(
      intro
    )
  );

  if (mentionBrand) {
    lines.push(
      `${capitalizeFirst(
        pickRandom(
          phrases.brandMentions,
          random
        )
      )}.`
    );
  }

  lines.push("");

  matches.forEach(
    (
      match,
      matchIndex
    ) => {
      if (matchIndex > 0) {
        lines.push(
          pickRandom(
            phrases.transitions,
            random
          )
        );

        lines.push("");
      }

      lines.push(
        `${spokenPickNumber(
          match.index
        )}.`
      );

      lines.push(
        buildTeamsVoiceLine(
          match
        )
      );

      lines.push("");

      lines.push(
        `${pickRandom(
          phrases.selectionLeadIns,
          random
        )} ${match.spokenMarket}.`
      );

      /*
       * Nu citim obligatoriu cota fiecărei selecții.
       * Uneori vocea sună mai natural fără repetarea
       * mecanică a tuturor cotelor.
       */
      const shouldReadOdd =
        matches.length <= 3 ||
        random() >= 0.35;

      if (shouldReadOdd) {
        lines.push(
          `${pickRandom(
            phrases.oddsLeadIns,
            random
          )} ${match.spokenOdds}.`
        );
      }

      lines.push("");
    }
  );

  lines.push(
    `${pickRandom(
      phrases.totalOdds,
      random
    )} ${spokenOdd(
      totalOdds
    )}.`
  );

  lines.push("");

  lines.push(
    pickRandom(
      phrases.outros,
      random
    )
  );

  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * =========================================================
 * BACKGROUND RANDOMIZATION
 * =========================================================
 */

function buildBackgroundPlan(
  random,
  estimatedDurationSeconds = 30
) {
  const shuffledFiles =
    shuffle(
      AVAILABLE_BACKGROUNDS,
      random
    );

  const segments = [];

  let currentTime = 0;
  let fileIndex = 0;

  while (
    currentTime <
    estimatedDurationSeconds
  ) {
    const duration =
      randomInteger(
        random,
        BACKGROUND_CHANGE_MIN_SECONDS,
        BACKGROUND_CHANGE_MAX_SECONDS
      );

    const remaining =
      estimatedDurationSeconds -
      currentTime;

    const segmentDuration =
      Math.min(
        duration,
        remaining
      );

    const file =
      shuffledFiles[
        fileIndex %
        shuffledFiles.length
      ];

    segments.push({
      index:
        segments.length,

      file,

      startSeconds:
        currentTime,

      durationSeconds:
        segmentDuration,

      zoom:
        randomDecimal(
          random,
          1.02,
          1.12,
          3
        ),

      xOffset:
        randomInteger(
          random,
          -35,
          35
        ),

      yOffset:
        randomInteger(
          random,
          -25,
          25
        ),

      mirror:
        random() >= 0.78,

      playbackRate:
        randomDecimal(
          random,
          0.92,
          1.08,
          3
        ),

      startOffsetSeconds:
        randomDecimal(
          random,
          0,
          5,
          2
        ),

      transition:
        pickRandom(
          [
            "fade",
            "crossfade",
            "cut"
          ],
          random
        ),

      transitionDurationSeconds:
        randomDecimal(
          random,
          0.2,
          0.6,
          2
        )
    });

    currentTime +=
      segmentDuration;

    fileIndex += 1;
  }

  return {
    enabled:
      shuffledFiles.length > 0,

    mode:
      "periodic_random",

    files:
      shuffledFiles,

    changeIntervalSeconds: {
      min:
        BACKGROUND_CHANGE_MIN_SECONDS,

      max:
        BACKGROUND_CHANGE_MAX_SECONDS
    },

    avoidImmediateRepeat:
      true,

    segments
  };
}

function buildPresenterVariation(
  random
) {
  return {
    horizontalPosition:
      pickRandom(
        [
          "left",
          "center",
          "right"
        ],
        random
      ),

    xOffset:
      randomInteger(
        random,
        -35,
        35
      ),

    yOffset:
      randomInteger(
        random,
        -15,
        20
      ),

    scale:
      randomDecimal(
        random,
        0.97,
        1.06,
        3
      ),

    mirror:
      random() >= 0.82,

    startOffsetSeconds:
      randomDecimal(
        random,
        0,
        2.8,
        2
      )
  };
}

/*
 * =========================================================
 * YOUTUBE METADATA
 * =========================================================
 */

function createMatchTitle(
  match
) {
  if (
    match.home &&
    match.away
  ) {
    return (
      `${match.home} vs ${match.away}`
    );
  }

  return match.teams;
}

function buildYouTubeTitle(
  label,
  matches,
  totalOdds
) {
  const matchText =
    matches
      .slice(0, 2)
      .map(
        createMatchTitle
      )
      .join(" + ");

  let title;

  if (LANG === "ro") {
    title =
      `${label}: ${matchText} | Cota ${totalOdds} #shorts`;
  } else {
    title =
      `${label}: ${matchText} | ${totalOdds} #shorts`;
  }

  if (
    title.length <= 100
  ) {
    return title;
  }

  return LANG === "ro"
    ? `${label} | Cota ${totalOdds} #shorts`
    : `${label} | Total Odds ${totalOdds} #shorts`;
}

function buildYouTubeDescription(
  label,
  date,
  totalOdds
) {
  const hashtags =
    [
      ...T.hashtags,
      BRAND_NAME.toLowerCase()
    ]
      .map(
        (tag) =>
          `#${tag.replace(
            /[^a-zA-Z0-9ăâîșțĂÂÎȘȚ_]/g,
            ""
          )}`
      )
      .join(" ");

  if (LANG === "ro") {
    return (
      `${label} pentru ${date}. ` +
      `Cota totală: ${totalOdds}.\n\n` +
      `Vezi biletul complet: ${SITE_URL}\n\n` +
      `${hashtags}`
    );
  }

  return (
    `${label} for ${date}. ` +
    `Combined odds: ${totalOdds}.\n\n` +
    `Full ticket: ${SITE_URL}\n\n` +
    `${hashtags}`
  );
}

/*
 * =========================================================
 * SKIPPED PAYLOAD
 * =========================================================
 */

async function writeSkippedPayload(
  reason,
  date
) {
  const skipped = {
    status:
      "skipped",

    version:
      4,

    reason,

    date:
      date || null,

    language:
      LANG,

    ticketType:
      TICKET_TYPE,

    brand: {
      name:
        BRAND_NAME,

      displayName:
        BRAND_DISPLAY,

      website:
        WEBSITE,

      websiteDisplay:
        WEBSITE_DISPLAY,

      url:
        SITE_URL
    }
  };

  await fs.mkdir(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  await fs.writeFile(
    path.join(
      OUTPUT_DIR,
      "shorts_payload.json"
    ),
    JSON.stringify(
      skipped,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[SHORTS] Skipped: ${reason}`
  );
}

/*
 * =========================================================
 * MAIN
 * =========================================================
 */

async function main() {
  const raw =
    await fs.readFile(
      INPUT_FILE,
      "utf8"
    );

  const tickets =
    JSON.parse(raw);

  await fs.mkdir(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  if (
    tickets.status ===
    "no_picks"
  ) {
    await writeSkippedPayload(
      tickets.reason ||
      T.noTicket,
      tickets.date
    );

    return;
  }

  const ticket =
    tickets[TICKET_TYPE];

  if (
    !ticket ||
    !Array.isArray(
      ticket.selections
    ) ||
    ticket.selections.length === 0
  ) {
    const reason =
      LANG === "ro"
        ? `${ticketLabel(
            TICKET_TYPE
          )} nu a fost generat.`
        : `${ticketLabel(
            TICKET_TYPE
          )} was not generated.`;

    await writeSkippedPayload(
      reason,
      tickets.date
    );

    return;
  }

  const matches =
    ticket.selections.map(
      selectionToPayload
    );

  const totalOdds =
    displayOdd(
      ticket.product ??
      ticket.totalOdds ??
      ticket.total_odds
    );

  const label =
    ticketLabel(
      TICKET_TYPE
    );

  const date =
    clean(
      tickets.date
    );

  /*
   * Seed stabil pentru combinația:
   * dată + limbă + tip bilet + echipe.
   */
  const randomSeed = [
    date,
    LANG,
    TICKET_TYPE,
    ...matches.map(
      (match) =>
        match.matchId ||
        match.teams
    )
  ].join("|");

  const random =
    createSeededRandom(
      randomSeed
    );

  const voiceScript =
    buildVoiceScript(
      matches,
      totalOdds,
      random
    );

  const targetDurationSeconds =
    Math.min(
      52,
      Math.max(
        25,
        14 +
        matches.length * 7
      )
    );

  const backgroundPlan =
    buildBackgroundPlan(
      random,
      targetDurationSeconds
    );

  const presenterVariation =
    buildPresenterVariation(
      random
    );

  const youtubeTags = [
    ...new Set([
      ...T.hashtags,
      BRAND_NAME.toLowerCase(),

      LANG === "ro"
        ? "pariuri sportive"
        : "sports betting"
    ])
  ];

  const payload = {
    status:
      "ready",

    version:
      4,

    generatedAt:
      new Date().toISOString(),

    randomSeed,

    language:
      LANG,

    date,

    ticketType:
      TICKET_TYPE,

    ticketLabel:
      label,

    brand: {
      name:
        BRAND_NAME,

      displayName:
        BRAND_DISPLAY,

      website:
        WEBSITE,

      websiteDisplay:
        WEBSITE_DISPLAY,

      url:
        SITE_URL
    },

    youtube: {
      title:
        buildYouTubeTitle(
          label,
          matches,
          totalOdds
        ),

      description:
        buildYouTubeDescription(
          label,
          date,
          totalOdds
        ),

      categoryId:
        "17",

      privacyStatus:
        process.env
          .YOUTUBE_PRIVACY_STATUS ||
        "public",

      tags:
        youtubeTags
    },

    wordpress: {
      postId:
        null,

      url:
        SITE_URL
    },

    visuals: {
      brand:
        BRAND_DISPLAY,

      headline:
        visualHeadline(
          TICKET_TYPE
        ),

      totalOdds,

      combinedOddsLabel:
        T.visualCombinedOdds,

      callToAction:
        T.visualWebsite,

      website:
        WEBSITE_DISPLAY,

      outroTop:
        T.visualOutroTop,

      subscribe:
        T.visualSubscribe,

      outroMessage:
        T.visualOutroMessage,

      presenterAsset:
        process.env
          .SHORTS_PRESENTER_FILE ||
        (
          LANG === "ro"
            ? "assets/presenters/ro_presenter_01.mp4"
            : "assets/presenters/presenter-01.mp4"
        ),

      presenterVariation,

      background:
        backgroundPlan,

      outputVideo:
        path.join(
          OUTPUT_DIR,
          "short.mp4"
        )
    },

    voice: {
      script:
        voiceScript,

      targetDurationSeconds,

      recommendedVoice:
        LANG === "ro"
          ? "ro-RO-AlinaNeural"
          : "en-US-AndrewNeural",

      recommendedRate:
        LANG === "ro"
          ? "-5%"
          : "-3%",

      outputFile:
        path.join(
          OUTPUT_DIR,
          "voice.mp3"
        )
    },

    subtitles: {
      outputFile:
        path.join(
          OUTPUT_DIR,
          "subs.srt"
        )
    },

    selections:
      matches
  };

  await Promise.all([
    fs.writeFile(
      path.join(
        OUTPUT_DIR,
        "shorts_payload.json"
      ),
      JSON.stringify(
        payload,
        null,
        2
      ),
      "utf8"
    ),

    fs.writeFile(
      path.join(
        OUTPUT_DIR,
        "voice_script.txt"
      ),
      `${voiceScript}\n`,
      "utf8"
    )
  ]);

  console.log(
    "[SHORTS] Payload ready"
  );

  console.log(
    `[SHORTS] Brand: ${BRAND_NAME}`
  );

  console.log(
    `[SHORTS] Language: ${LANG}`
  );

  console.log(
    `[SHORTS] Ticket: ${TICKET_TYPE}`
  );

  console.log(
    `[SHORTS] Selections: ${matches.length}`
  );

  console.log(
    `[SHORTS] Total odds: ${totalOdds}`
  );

  console.log(
    `[SHORTS] Voice target: ${targetDurationSeconds} seconds`
  );

  console.log(
    `[SHORTS] Background segments: ${backgroundPlan.segments.length}`
  );

  console.log(
    `[SHORTS] Output: ${OUTPUT_DIR}`
  );
}

main().catch(
  (error) => {
    console.error(
      "[SHORTS] Payload generation failed:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
);
