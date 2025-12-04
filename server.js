// server.js
const express = require("express");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json({ limit: "100mb" }));

// environment variables required
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "videos";
const TEMP_DIR = "/tmp";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// helper: download a URL to local file
async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} - ${res.status}`);
  const fileStream = fs.createWriteStream(destPath);
  await new Promise((resv, rej) => {
    res.body.pipe(fileStream);
    res.body.on("error", rej);
    fileStream.on("finish", resv);
  });
  return destPath;
}

// helper: run ffmpeg asynchronously and return a Promise
function runFfmpeg(args, logPrefix = "") {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args);
    ff.stdout.on("data", (d) => console.log(`${logPrefix} ${d.toString()}`));
    ff.stderr.on("data", (d) => console.log(`${logPrefix} ${d.toString()}`));
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}`));
    });
    ff.on("error", (err) => reject(err));
  });
}

app.post("/render", async (req, res) => {
  try {
    /*
      Expected payload:
      {
        videoUrl: string,
        audioUrl?: string,
        videoTrim?: { start, end },
        audioTrim?: { start, end },
        videoVolume?: number, // 0..1
        musicVolume?: number  // 0..1
      }
    */
    const { videoUrl, audioUrl, videoTrim, audioTrim, videoVolume = 1, musicVolume = 1 } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

    const id = uuidv4();
    const videoPath = path.join(TEMP_DIR, `${id}-video.mp4`);
    const audioPath = audioUrl ? path.join(TEMP_DIR, `${id}-audio${Date.now()}.mp3`) : null;
    const outPath = path.join(TEMP_DIR, `${id}-final.mp4`);

    // download
    await downloadToFile(videoUrl, videoPath);
    if (audioUrl) await downloadToFile(audioUrl, audioPath);

    // Build ffmpeg args
    // We'll use input arguments straightforwardly and apply filter_complex when mixing.
    const args = [];

    // video input
    args.push("-i", videoPath);

    // audio input (optional)
    if (audioUrl) args.push("-i", audioPath);

    // Construct filters:
    // If audio provided, mix [0:a] (video) and [1:a] (music) with volume adjustments.
    if (audioUrl) {
      // filter_complex string
      // ensure inputs exist (some videos may have no audio)
      // handle missing audio gracefully by using anullsrc if necessary is more complex;
      // for now assume 0:a exists or is empty.
      const filter = `[0:a]volume=${videoVolume}[a0];[1:a]volume=${musicVolume}[a1];[a0][a1]amerge=inputs=2[aout]`;
      // Use amerge then pan to stereo (if needed) or use amix. amix sums; amerge merges channels.
      // We'll use amix for a simpler mix:
      const filterAmix = `[0:a]volume=${videoVolume}[a0];[1:a]volume=${musicVolume}[a1];[a0][a1]amix=inputs=2:duration=shortest[aout]`;

      args.push("-filter_complex", filterAmix, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-y", outPath);
    } else {
      // no external audio: maybe change volume or copy
      if (Number(videoVolume) !== 1) {
        args.push("-map", "0:v", "-map", "0:a?", "-c:v", "copy", "-filter:a", `volume=${videoVolume}`, "-c:a", "aac", "-b:a", "192k", "-y", outPath);
      } else {
        args.push("-map", "0:v", "-map", "0:a?", "-c", "copy", "-y", outPath);
      }
    }

    console.log("Running ffmpeg", args.join(" "));

    await runFfmpeg(args, "[ffmpeg]");

    // upload final file to Supabase storage
    const finalName = `${Date.now()}-${id}.mp4`;
    const fileBuffer = fs.readFileSync(outPath);

    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(finalName, fileBuffer, { contentType: "video/mp4" });

    if (uploadErr) {
      console.error("upload error", uploadErr);
      return res.status(500).json({ error: "upload failed", detail: uploadErr });
    }

    const { data: urlData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(finalName);

    // cleanup
    try { fs.unlinkSync(videoPath); } catch(e){/*ignore*/}
    try { if (audioPath) fs.unlinkSync(audioPath); } catch(e){/*ignore*/}
    try { fs.unlinkSync(outPath); } catch(e){/*ignore*/}

    return res.json({ success: true, publicUrl: urlData.publicUrl });
  } catch (err) {
    console.error("render error", err);
    return res.status(500).json({ error: String(err) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Render FFmpeg server listening on", port));
