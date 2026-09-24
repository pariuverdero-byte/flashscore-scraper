export const SITES = {
  pariuverde: {
    key: "pariuverde",
    language: "ro",
    siteUrl: "https://pariuverde.ro",
    brandName: "PariuVerde",
    brandDisplay: "PARIUVERDE",
    websiteDisplay: "WWW.PARIUVERDE.RO",

    /*
     * WordPress tag IDs confirmed for pariuverde.ro.
     */
    queueTagId: 711,
    doneTagId: 710,

    presenterFiles: [
      "assets/intros/ro/intro_01.mp4",
      "assets/intros/ro/intro_02.mp4",
      "assets/intros/ro/intro_03.mp4",
      "assets/intros/ro/intro_04.mp4",
      "assets/intros/ro/intro_05.mp4",
      "assets/intros/ro/intro_06.mp4",
      "assets/intros/ro/intro_07.mp4"
    ],

    ttsVoice: "ro-RO-EmilNeural",
    ttsRate: "-5%",
    youtubeCategoryId: "17",
    youtubePrivacyStatus: "public",

    hashtags: [
      "pariuverde",
      "pariuri",
      "ponturi",
      "fotbal",
      "pronosticuri",
      "shorts"
    ]
  },

  greenbettips: {
    key: "greenbettips",
    language: "en",
    siteUrl: "https://greenbettips.com",
    brandName: "GreenBetTips",
    brandDisplay: "GREENBETTIPS",
    websiteDisplay: "WWW.GREENBETTIPS.COM",

    /*
     * IDs previously returned by the GreenBetTips REST API.
     * They can be overridden from the workflow if needed.
     */
    queueTagId: 708,
    doneTagId: 709,

    presenterFiles: [
      "assets/intros/en/intro_01.mp4",
      "assets/intros/en/intro_02.mp4",
      "assets/intros/en/intro_03.mp4",
      "assets/intros/en/intro_04.mp4",
      "assets/intros/en/intro_05.mp4",
      "assets/intros/en/intro_06.mp4",
      "assets/intros/en/intro_07.mp4",
      "assets/intros/en/intro_08.mp4"
    ],

    ttsVoice: "en-US-AndrewNeural",
    ttsRate: "-3%",
    youtubeCategoryId: "17",
    youtubePrivacyStatus: "public",

    hashtags: [
      "greenbettips",
      "football",
      "footballpredictions",
      "bettingtips",
      "soccer",
      "shorts"
    ]
  }
};

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

export function getSiteConfig(siteKey) {
  const key = String(siteKey || "")
    .trim()
    .toLowerCase();

  const base = SITES[key];

  if (!base) {
    throw new Error(
      `Unknown OCCASIONAL_SITE_KEY: ${siteKey}. ` +
      "Expected pariuverde or greenbettips."
    );
  }

  return {
    ...base,

    queueTagId: positiveInteger(
      process.env.OCCASIONAL_QUEUE_TAG_ID,
      base.queueTagId
    ),

    doneTagId: positiveInteger(
      process.env.OCCASIONAL_DONE_TAG_ID,
      base.doneTagId
    )
  };
}
