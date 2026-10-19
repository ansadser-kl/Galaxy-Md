"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

module.exports = {
  name: "video",
  aliases: ["ytv"],
  description: "Download YouTube videos in 360p",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Send a YouTube link with the command.\nExample: .video https://youtu.be/VIDEO_ID" },
        { quoted: message }
      );
    }

    try {
      await sock.sendMessage(jid, { text: "Getting 360p video..." }, { quoted: message });

      const response = await fetch("https://api.ytultra.com/ikool/youtube/download", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("Downloader API returned HTTP " + response.status);
      const result = await response.json();

      if (result?.code !== "0000" || !Array.isArray(result?.data?.medias)) {
        throw new Error(result?.msg || "Could not get video details from API.");
      }

      const media = result.data.medias.find(item =>
        item && item.quality === "360p" && !item.locked &&
        typeof item.url === "string" && /^https?:\/\//i.test(item.url) &&
        /\.mp4/i.test(item.format || "")
      );

      if (!media) throw new Error("360p MP4 download is unavailable for this video.");

      const download = await fetch(media.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(180000)
      });

      if (!download.ok) throw new Error("Video download failed (HTTP " + download.status + ").");
      const buffer = Buffer.from(await download.arrayBuffer());
      if (!buffer.length) throw new Error("The downloaded video is empty.");

      const input = path.join(os.tmpdir(), "galaxy-video-" + Date.now() + ".mp4");
      const output = input.replace(/\.mp4$/, "-compressed.mp4");
      try {
        fs.writeFileSync(input, buffer);
        await sock.sendMessage(jid, { text: "Compressing 360p video for WhatsApp..." }, { quoted: message });
        await execFileAsync("ffmpeg", [
          "-y", "-i", input, "-vf", "scale=-2:360", "-c:v", "libx264",
          "-preset", "veryfast", "-b:v", "650k", "-maxrate", "800k",
          "-bufsize", "1300k", "-c:a", "aac", "-b:a", "96k",
          "-movflags", "+faststart", output
        ], { timeout: 300000 });

        const compressed = fs.readFileSync(output);
        if (!compressed.length) throw new Error("FFmpeg produced an empty video.");
        if (compressed.length > 64 * 1024 * 1024) {
          throw new Error("Compressed video is still too large for WhatsApp.");
        }

        await sock.sendMessage(jid, {
          video: compressed,
          mimetype: "video/mp4",
          fileName: "galaxy-video-360p.mp4",
          caption: (result.data.title || "YouTube Video") + "\nQuality: 360p (compressed)"
        }, { quoted: message });
      } finally {
        for (const file of [input, output]) {
          try { fs.unlinkSync(file); } catch {}
        }
      }
    } catch (error) {
      console.error("[GALAXY-MD] Video download failed:", error);
      await sock.sendMessage(
        jid,
        { text: "Video download failed.\n" + String(error?.message || error).slice(0, 250) },
        { quoted: message }
      );
    }
  }
};
