const express = require("express");
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();

/* ---------------- CORS ---------------- */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "200mb" }));

/* ---------------- ENV ---------------- */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "videos";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/* ---------------- HELPERS ---------------- */
function runFFmpeg(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(stderr);
      resolve(stdout);
    });
  });
}

/* ---------------- RENDER ---------------- */
app.post("/render", async (req, res) => {
  try {
    const { videoUrl, audioUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "Missing videoUrl" });

    const id = uuidv4();
    const vIn = `/tmp/in_${id}.mp4`;
    const aIn = `/tmp/a_${id}.mp3`;
    const vOut = `/tmp/out_${id}.mp4`;
    const tOut = `/tmp/thumb_${id}.jpg`;

    fs.writeFileSync(vIn, Buffer.from(await (await fetch(videoUrl)).arrayBuffer()));
    if (audioUrl) {
      fs.writeFileSync(aIn, Buffer.from(await (await fetch(audioUrl)).arrayBuffer()));
    }

    let cmd = `ffmpeg -y -i "${vIn}"`;
    if (audioUrl) {
      cmd += ` -i "${aIn}" -filter_complex "[0:a][1:a]amix=inputs=2[a]" -map 0:v -map "[a]" -c:v libx264 -c:a aac`;
    } else {
      cmd += ` -map 0:v -map 0:a? -c:v libx264 -c:a copy`;
    }
    cmd += ` "${vOut}"`;
    await runFFmpeg(cmd);

    await runFFmpeg(`ffmpeg -y -i "${vOut}" -ss 1 -vframes 1 "${tOut}"`);

    const vName = `renders/${id}.mp4`;
    const tName = `renders/${id}.jpg`;

    await supabase.storage.from(SUPABASE_BUCKET).upload(vName, fs.readFileSync(vOut), { upsert: true });
    await supabase.storage.from("thumbnails").upload(tName, fs.readFileSync(tOut), { upsert: true });

    const video = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(vName);
    const thumb = supabase.storage.from("thumbnails").getPublicUrl(tName);

    res.json({
      success: true,
      url: video.data.publicUrl,
      thumbnailUrl: thumb.data.publicUrl,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.listen(process.env.PORT || 8080, () =>
  console.log("🚀 Render server running")
);
