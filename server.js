import express from "express";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json({ limit: "50mb" }));

// environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// -----------------------------
// Render mix endpoint
// -----------------------------
app.post("/render", async (req, res) => {
  try {
    const { videoUrl, audioUrl, videoVolume, musicVolume } = req.body;

    if (!videoUrl) return res.status(400).json({ error: "Missing videoUrl" });

    const id = uuidv4();
    const inputVideo = `/app/input-${id}.mp4`;
    const inputAudio = `/app/input-${id}.mp3`;
    const outputFile = `/app/output-${id}.mp4`;

    // download source video
    const videoResp = await fetch(videoUrl);
    const videoBuf = await videoResp.arrayBuffer();
    fs.writeFileSync(inputVideo, Buffer.from(videoBuf));

    // optional audio
    if (audioUrl) {
      const audioResp = await fetch(audioUrl);
      const audioBuf = await audioResp.arrayBuffer();
      fs.writeFileSync(inputAudio, Buffer.from(audioBuf));
    }

    // ffmpeg command
    let cmd = "";

    if (audioUrl) {
      cmd = `
        ffmpeg -i ${inputVideo} -i ${inputAudio} \
        -filter_complex "[0:a]volume=${videoVolume}[v];[1:a]volume=${musicVolume}[m];[v][m]amix=inputs=2:normalize=1" \
        -c:v copy -c:a aac ${outputFile}
      `;
    } else {
      cmd = `ffmpeg -i ${inputVideo} -c:v copy -c:a aac ${outputFile}`;
    }

    exec(cmd, async (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "FFmpeg failed" });
      }

      const finalFile = fs.readFileSync(outputFile);

      const upload = await supabase.storage
        .from("renders")
        .upload(`output/${id}.mp4`, finalFile, {
          contentType: "video/mp4",
        });

      if (upload.error) return res.status(500).json(upload.error);

      res.json({
        status: "success",
        url: `${SUPABASE_URL}/storage/v1/object/public/renders/output/${id}.mp4`,
      });

      // cleanup
      fs.unlinkSync(inputVideo);
      if (audioUrl) fs.unlinkSync(inputAudio);
      fs.unlinkSync(outputFile);
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(process.env.PORT || 8080, () =>
  console.log("FFmpeg server running!")
);
