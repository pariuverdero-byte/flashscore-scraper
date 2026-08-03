export const SITES = {
  pariuverde: {
    key: "pariuverde",
    language: "ro",
    siteUrl: "https://pariuverde.ro",
    brandName: "PariuVerde",
    brandDisplay: "PARIUVERDE",
    websiteDisplay: "WWW.PARIUVERDE.RO",
    presenterFiles: [
      "assets/presenters/ro_presenter_01.mp4",
      "assets/presenters/ro_presenter_02.mp4",
      "assets/presenters/ro_presenter_03.mp4"
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
    presenterFiles: [
      "assets/presenters/en_presenter_01.mp4",
      "assets/presenters/en_presenter_02.mp4",
      "assets/presenters/en_presenter_03.mp4"
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

export function getSiteConfig(siteKey) {
  const config = SITES[String(siteKey || "").trim().toLowerCase()];

  if (!config) {
    throw new Error(
      `Unknown OCCASIONAL_SITE_KEY: ${siteKey}. Expected pariuverde or greenbettips.`
    );
  }

  return config;
}
