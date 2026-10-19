"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

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

    const tempFile = path.join(os.tmpdir(), "galaxy-video-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4");

    try {
      await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

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
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("Video download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stat = fs.statSync(tempFile);
      if (!stat.size) throw new Error("The downloaded video is empty.");

      await sock.sendMessage(jid, { text: "Sending..." }, { quoted: message });

      const file = fs.readFileSync(tempFile);
      const caption = (result.data.title || "YouTube Video") + "\nQuality: 360p";
      if (stat.size > 180 * 1024 * 1024) {
        await sock.sendMessage(jid, {
          document: file,
          mimetype: "video/mp4",
          fileName: "galaxy-video-360p.mp4",
          caption: caption + "\nSent as document because file exceeds 180 MB."
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          video: file,
          mimetype: "video/mp4",
          fileName: "galaxy-video-360p.mp4",
          caption
        }, { quoted: message });
      }
    } catch (error) {
      console.error("[GALAXY-MD] Video download failed:", error);
      await sock.sendMessage(
        jid,
        { text: "Video download failed.\n" + String(error?.message || error).slice(0, 250) },
        { quoted: message }
      );
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
