import fs from "fs";
import { escapeFfmpegFilterPath, requireFile, run } from "./helpers.js";

export function renderArticleVideo({ presenterFile, voiceFile, subtitlesFile, titleFile, websiteFile, videoFile }) {
  [presenterFile, voiceFile, subtitlesFile, titleFile, websiteFile].forEach(requireFile);

  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const title = escapeFfmpegFilterPath(titleFile);
  const website = escapeFfmpegFilterPath(websiteFile);
  const subs = escapeFfmpegFilterPath(subtitlesFile);

  const filter = [
    "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]",
    "[base]drawbox=x=45:y=55:w=990:h=360:color=black@0.62:t=fill[box1]",
    `[box1]drawtext=fontfile=${font}:textfile='${title}':reload=0:fontcolor=white:fontsize=58:line_spacing=14:x=(w-text_w)/2:y=105:box=0:fix_bounds=1[title]`,
    "[title]drawbox=x=45:y=1690:w=990:h=165:color=black@0.68:t=fill[box2]",
    `[box2]drawtext=fontfile=${font}:textfile='${website}':reload=0:fontcolor=white:fontsize=48:x=(w-text_w)/2:y=1745:fix_bounds=1[url]`,
    `[url]subtitles='${subs}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,BackColour=&H90000000,Outline=2,Shadow=0,MarginV=250,Alignment=2'[v]`
  ].join(";");

  run("ffmpeg", [
    "-y",
    "-stream_loop", "-1",
    "-i", presenterFile,
    "-i", voiceFile,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    videoFile
  ]);

  requireFile(videoFile);
}
