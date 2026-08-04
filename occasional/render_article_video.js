import {
  escapeFfmpegFilterPath,
  requireFile,
  run
} from "./helpers.js";

const FONT_FILE =
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

const VISUAL_PRESETS = [
  {
    saturation: 1.00,
    contrast: 1.02,
    brightness: -0.01
  },
  {
    saturation: 1.08,
    contrast: 1.04,
    brightness: -0.02
  },
  {
    saturation: 0.94,
    contrast: 1.06,
    brightness: -0.01
  },
  {
    saturation: 1.04,
    contrast: 1.03,
    brightness: 0.00
  },
  {
    saturation: 0.98,
    contrast: 1.08,
    brightness: -0.03
  },
  {
    saturation: 1.10,
    contrast: 1.01,
    brightness: -0.01
  }
];

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function even(
  value
) {
  const rounded =
    Math.round(value);

  return rounded % 2 === 0
    ? rounded
    : rounded + 1;
}

export function renderArticleVideo({
  presenterFile,
  voiceFile,
  titleFile,
  websiteFile,
  videoFile,
  variation = {}
}) {
  [
    presenterFile,
    voiceFile,
    titleFile,
    websiteFile
  ].forEach(
    requireFile
  );

  const title =
    escapeFfmpegFilterPath(
      titleFile
    );

  const website =
    escapeFfmpegFilterPath(
      websiteFile
    );

  const zoom =
    clamp(
      Number(
        variation.zoom ||
        1.04
      ),
      1.01,
      1.10
    );

  const scaledWidth =
    even(
      1080 *
      zoom
    );

  const scaledHeight =
    even(
      1920 *
      zoom
    );

  const maximumX =
    Math.max(
      0,
      scaledWidth -
      1080
    );

  const maximumY =
    Math.max(
      0,
      scaledHeight -
      1920
    );

  const cropX =
    clamp(
      Math.round(
        maximumX / 2 +
        Number(
          variation.offsetX ||
          0
        )
      ),
      0,
      maximumX
    );

  const cropY =
    clamp(
      Math.round(
        maximumY / 2 +
        Number(
          variation.offsetY ||
          0
        )
      ),
      0,
      maximumY
    );

  const mirror =
    variation.mirror === true;

  const presetIndex =
    Math.abs(
      Number(
        variation.presetIndex ||
        0
      )
    ) %
    VISUAL_PRESETS.length;

  const preset =
    VISUAL_PRESETS[
      presetIndex
    ];

  const presenterFilters = [
    `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase`,
    `crop=1080:1920:${cropX}:${cropY}`,
    "setsar=1",
    mirror
      ? "hflip"
      : null,
    `eq=saturation=${preset.saturation}:contrast=${preset.contrast}:brightness=${preset.brightness}`
  ]
    .filter(Boolean)
    .join(",");

  const filter = [
    `[0:v]${presenterFilters}[base]`,

    "[base]drawbox=x=45:y=55:w=990:h=360:color=black@0.62:t=fill[box1]",

    `[box1]drawtext=fontfile=${FONT_FILE}:textfile='${title}':reload=0:fontcolor=white:fontsize=58:line_spacing=14:x=(w-text_w)/2:y=105:box=0:fix_bounds=1[title]`,

    "[title]drawbox=x=45:y=1690:w=990:h=165:color=black@0.68:t=fill[box2]",

    `[box2]drawtext=fontfile=${FONT_FILE}:textfile='${website}':reload=0:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=1745:fix_bounds=1[v]`
  ].join(";");

  console.log(
    `[OCCASIONAL] Visual variation: zoom=${zoom.toFixed(
      2
    )}, offsetX=${cropX}, offsetY=${cropY}, mirror=${mirror}, preset=${presetIndex}`
  );

  run(
    "ffmpeg",
    [
      "-y",

      "-stream_loop",
      "-1",

      "-i",
      presenterFile,

      "-i",
      voiceFile,

      "-filter_complex",
      filter,

      "-map",
      "[v]",

      "-map",
      "1:a:0",

      "-c:v",
      "libx264",

      "-preset",
      "medium",

      "-crf",
      "21",

      "-pix_fmt",
      "yuv420p",

      "-r",
      "30",

      "-c:a",
      "aac",

      "-b:a",
      "192k",

      "-shortest",

      "-movflags",
      "+faststart",

      videoFile
    ]
  );

  requireFile(
    videoFile
  );
}
