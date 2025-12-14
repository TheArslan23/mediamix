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
    const thumbPath = `/tmp/thumb_${id}.jpg`;

    // -----------------------
    // DOWNLOAD VIDEO
    // -----------------------
    const videoResp = await fetch(videoUrl);
    fs.writeFileSync(tempVideo, Buffer.from(await videoResp.arrayBuffer()));

    if (audioUrl) {
      const audioResp = await fetch(audioUrl);
      fs.writeFileSync(tempAudio, Buffer.from(await audioResp.arrayBuffer()));
    }

    // -----------------------
    // RENDER VIDEO
    // -----------------------
    let ffmpegCmd = `ffmpeg -y -i "${tempVideo}"`;

    if (audioUrl) {
      ffmpegCmd += ` -i "${tempAudio}" \
        -filter_complex \
        "[0:a]volume=1[a0]; \
         [1:a]volume=1[a1]; \
         [a0][a1]amix=inputs=2:dropout_transition=0[aout]" \
        -map 0:v -map "[aout]" \
        -c:v libx264 -c:a aac -shortest`;
    } else {
      ffmpegCmd += ` -map 0:v -map 0:a? -c:v libx264 -c:a copy`;
    }

    ffmpegCmd += ` "${finalOutput}"`;
    await runFFmpeg(ffmpegCmd);

    // -----------------------
    // GENERATE THUMBNAIL
    // -----------------------
    await runFFmpeg(
      `ffmpeg -y -i "${finalOutput}" -ss 00:00:01 -vframes 1 "${thumbPath}"`
    );

    // -----------------------
    // UPLOAD VIDEO
    // -----------------------
    const videoBuffer = fs.readFileSync(finalOutput);
    const videoName = `renders/output_${id}.mp4`;

    await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(videoName, videoBuffer, {
        contentType: "video/mp4",
        upsert: true,
      });

    const { data: videoUrlData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(videoName);

    // -----------------------
    // UPLOAD THUMBNAIL
    // -----------------------
    const thumbBuffer = fs.readFileSync(thumbPath);
    const thumbName = `renders/thumb_${id}.jpg`;

    await supabase.storage
      .from("thumbnails")
      .upload(thumbName, thumbBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    const { data: thumbUrlData } = supabase.storage
      .from("thumbnails")
      .getPublicUrl(thumbName);

    // -----------------------
    // CLEANUP
    // -----------------------
    try { fs.unlinkSync(tempVideo); } catch {}
    try { fs.unlinkSync(tempAudio); } catch {}
    try { fs.unlinkSync(finalOutput); } catch {}
    try { fs.unlinkSync(thumbPath); } catch {}

    // -----------------------
    // RESPONSE
    // -----------------------
    return res.json({
      success: true,
      url: videoUrlData.publicUrl,
      thumbnailUrl: thumbUrlData.publicUrl,
    });

  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: String(err) });
  }
});
