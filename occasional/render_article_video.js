import { execFileSync } from "child_process";

import { escapeFfmpegFilterPath, requireFile, run } from "./helpers.js";

const FONT_FILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const GENERIC_DURATION = 2.5;
const TRANSITION_DURATION = 0.65;
const OUTRO_DURATION = 2.5;

function mediaDuration(filePath) {
  const output = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8" });

  const duration = Number(String(output).trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine media duration: ${filePath}`);
  }
  return duration;
}

export function renderArticleVideo({
  presenterFile,
  voiceFile,
  subtitlesFile,
  titleFile,
  websiteFile,
  videoFile
}) {
  [presenterFile, voiceFile, subtitlesFile, titleFile, websiteFile, FONT_FILE]
    .forEach(requireFile);

  const presenterDuration = mediaDuration(presenterFile);
  const voiceDuration = mediaDuration(voiceFile);
  const title = escapeFfmpegFilterPath(titleFile);
  const website = escapeFfmpegFilterPath(websiteFile);
  const subtitles = escapeFfmpegFilterPath(subtitlesFile);

  const filter = [
    `color=c=0x061B12:s=1080x1920:r=30:d=${GENERIC_DURATION}` +
      ",drawbox=x=0:y=0:w=1080:h=18:color=0x38E878:t=fill" +
      `,drawtext=fontfile='${FONT_FILE}':textfile='${website}':fontcolor=0x38E878:fontsize=56:x=(w-text_w)/2:y=760` +
      ",fade=t=in:st=0:d=0.3" +
      `,fade=t=out:st=${GENERIC_DURATION - 0.3}:d=0.3` +
      ",format=yuv420p,setsar=1,setpts=PTS-STARTPTS[generic_v]",

    `anullsrc=r=48000:cl=stereo,atrim=duration=${GENERIC_DURATION},asetpts=PTS-STARTPTS[generic_a]`,

    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase," +
      "crop=1080:1920,fps=30,setsar=1," +
      `trim=duration=${presenterDuration.toFixed(3)},setpts=PTS-STARTPTS[presenter_v]`,

    "[0:a]aresample=48000," +
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
      `atrim=duration=${presenterDuration.toFixed(3)},asetpts=PTS-STARTPTS[presenter_a]`,

    `color=c=0x38E878:s=1080x1920:r=30:d=${TRANSITION_DURATION}` +
      ",drawbox=x=720:y=0:w=360:h=1920:color=0x072B1A:t=fill," +
      "format=yuv420p,setsar=1,setpts=PTS-STARTPTS[transition_v]",

    `anullsrc=r=48000:cl=stereo,atrim=duration=${TRANSITION_DURATION},asetpts=PTS-STARTPTS[transition_a]`,

    `color=c=0x063D24:s=1080x1920:r=30:d=${voiceDuration.toFixed(3)}` +
      ",drawbox=x=55:y=90:w=970:h=430:color=black@0.55:t=fill" +
      ",drawbox=x=55:y=90:w=970:h=430:color=0x38E878@0.75:t=3" +
      `,drawtext=fontfile='${FONT_FILE}':textfile='${title}':fontcolor=white:fontsize=58:line_spacing=14:x=(w-text_w)/2:y=145:fix_bounds=1` +
      ",drawbox=x=45:y=1660:w=990:h=190:color=black@0.70:t=fill" +
      `,drawtext=fontfile='${FONT_FILE}':textfile='${website}':fontcolor=0x38E878:fontsize=44:x=(w-text_w)/2:y=1725:fix_bounds=1` +
      `,subtitles=filename='${subtitles}':force_style='FontName=DejaVu Sans,FontSize=19,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00111111,BackColour=&H88000000,BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginL=70,MarginR=70,MarginV=430'` +
      ",format=yuv420p,setsar=1,setpts=PTS-STARTPTS[story_v]",

    "[1:a]aresample=48000," +
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
      `atrim=duration=${voiceDuration.toFixed(3)},asetpts=PTS-STARTPTS[story_a]`,

    `color=c=0x061B12:s=1080x1920:r=30:d=${OUTRO_DURATION}` +
      `,drawtext=fontfile='${FONT_FILE}':textfile='${website}':fontcolor=0x38E878:fontsize=56:x=(w-text_w)/2:y=820` +
      ",format=yuv420p,setsar=1,setpts=PTS-STARTPTS[outro_v]",

    `anullsrc=r=48000:cl=stereo,atrim=duration=${OUTRO_DURATION},asetpts=PTS-STARTPTS[outro_a]`,

    "[generic_v][generic_a]" +
      "[presenter_v][presenter_a]" +
      "[transition_v][transition_a]" +
      "[story_v][story_a]" +
      "[outro_v][outro_a]" +
      "concat=n=5:v=1:a=1[final_v][final_a]"
  ].join(";");

  console.log(
    `[OCCASIONAL] News format: generic=${GENERIC_DURATION}s, ` +
    `presenter=${presenterDuration.toFixed(2)}s, narration=${voiceDuration.toFixed(2)}s`
  );

  run("ffmpeg", [
    "-y",
    "-i", presenterFile,
    "-i", voiceFile,
    "-filter_complex", filter,
    "-map", "[final_v]",
    "-map", "[final_a]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    videoFile
  ]);

  requireFile(videoFile);
}
