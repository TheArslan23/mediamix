const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();

// ⭐ FIX CORS COMPLETELY ⭐
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // allow all origins
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});


// Body parsers
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));

// -----------------------
// ENVIRONMENT VARIABLES
// -----------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "videos";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing Supabase environment variables!");
  process.exit(1);
}

console.log("✅ Supabase URL:", SUPABASE_URL);
console.log("✅ Supabase Bucket:", SUPABASE_BUCKET);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// -----------------------
// HELPER — run FFmpeg
// -----------------------
function runFFmpeg(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg Error:", stderr);
        return reject(stderr);
      }
      resolve(stdout);
    });
  });
}

// -----------------------
// MAIN ROUTE — /render
// -----------------------
app.post("/render", async (req, res) => {
  try {
    const { videoUrl, audioUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: "Missing videoUrl" });
    }

    const id = uuidv4();
    const tempVideo = `/tmp/input_${id}.mp4`;
    const tempAudio = `/tmp/audio_${id}.mp3`;
    const finalOutput = `/tmp/output_${id}.mp4`;

    console.log("⬇️ Downloading video...");
    const videoResp = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    fs.writeFileSync(tempVideo, videoBuffer);

    if (audioUrl) {
      console.log("⬇️ Downloading audio...");
      const audioResp = await fetch(audioUrl);
      const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
      fs.writeFileSync(tempAudio, audioBuffer);
    }

    // -----------------------
    // FFmpeg Command
    // -----------------------
    let ffmpegCmd = `ffmpeg -i "${tempVideo}"`;

    if (audioUrl) {
      ffmpegCmd += ` -i "${tempAudio}" -map 0:v -map 1:a -c:v libx264 -c:a aac -shortest`;
    } else {
      ffmpegCmd += ` -c:v libx264 -c:a copy`;
    }

    ffmpegCmd += ` "${finalOutput}" -y`;

    console.log("🎬 Running FFmpeg...");
    await runFFmpeg(ffmpegCmd);

    // -----------------------
    // UPLOAD RESULT
    // -----------------------
    console.log("⬆️ Uploading final video to Supabase...");
    const fileBuffer = fs.readFileSync(finalOutput);
    const fileName = `renders/output_${id}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(fileName, fileBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      console.error(uploadError);
      return res.status(500).json({ error: "Upload failed", detail: uploadError });
    }

    const { data: publicUrlData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(fileName);

    // Cleanup temp files
    try { fs.unlinkSync(tempVideo); } catch {}
    try { fs.unlinkSync(tempAudio); } catch {}
    try { fs.unlinkSync(finalOutput); } catch {}

    console.log("🎉 Render complete:", publicUrlData.publicUrl);

    return res.json({
      success: true,
      url: publicUrlData.publicUrl,
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// -----------------------
// START SERVER
// -----------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 FFmpeg render server running on port ${PORT}`);
});
