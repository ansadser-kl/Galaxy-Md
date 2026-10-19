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
    let input = String(text || args?.join(" ") || "").trim();
    let url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid YouTube link!\nExample: .video https://youtube.com/watch?v=xxxxx or https://youtube.com/shorts/xxxxx" },
        { quoted: message }
      );
    }

    if (url.includes("youtube.com/shorts/")) {
      const shortId = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/)?.[1];
      if (shortId) url = "https://www.youtube.com/watch?v=" + shortId;
    }

    const tempFile = path.join(os.tmpdir(), "galaxy-video-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4");
    let statusMessage;

    const editStatus = async (text) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text }, { edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

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
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded video is empty.");

      await editStatus("Sending...");

      const caption = (result.data.title || "YouTube Video") + "\nQuality: 360p";
      const stream = fs.createReadStream(tempFile);
      try {
        if (stats.size > 180 * 1024 * 1024) {
          await sock.sendMessage(jid, {
            document: stream,
            mimetype: "video/mp4",
            fileName: "galaxy-video-360p.mp4",
            caption: caption + "\nSent as document because file exceeds 180 MB."
          }, { quoted: message });
        } else {
          await sock.sendMessage(jid, {
            video: stream,
            mimetype: "video/mp4",
            fileName: "galaxy-video-360p.mp4",
            caption
          }, { quoted: message });
        }
      } finally {
        stream.destroy();
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Video download failed:", error);
      try {
        await editStatus("Download failed!\n" + String(error?.message || error).slice(0, 200));
      } catch {
        await sock.sendMessage(
          jid,
          { text: "Download failed. Please try again." },
          { quoted: message }
        );
      }
    } finally {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
};
