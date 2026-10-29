"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "video",
  aliases: [],
  description: "Download YouTube videos in 720p",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
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

    // Default to 720p; optionally allow .video <url> 360 / 480 / 720 / 1080.
    const qualityMatch = input.match(/(?:^|\s)(144|240|360|480|720|1080)p?(?:\s|$)/i);
    const quality = qualityMatch ? qualityMatch[1] : "720";
    const qualityLabel = quality + "p";
    const tempFile = path.join(os.tmpdir(), "galaxy-video-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4");
    let statusMessage;

    const editStatus = async (status) => {
      if (statusMessage?.key) {
        return sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      }
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "Downloading..." }, { quoted: message });

      const apiUrl = new URL("https://xenosirapis.zone.id/api/ytvideo2");
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("quality", quality);

      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("Downloader API returned HTTP " + response.status);
      const result = await response.json();

      if (result?.success !== true || typeof result?.downloadUrl !== "string" ||
          !/^https?:\/\//i.test(result.downloadUrl)) {
        throw new Error("Could not get video download link from API.");
      }

      const download = await fetch(result.downloadUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "video/mp4,*/*" },
        signal: AbortSignal.timeout(300000)
      });

      if (!download.ok || !download.body) {
        throw new Error("Video download failed (HTTP " + download.status + ").");
      }

      await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("The downloaded video is empty.");

      await editStatus("Sending...");

      const title = String(result.title || "YouTube Video").slice(0, 180);
      const caption = title + "\nQuality: " + (result.quality || qualityLabel);
      if (stats.size > 180 * 1024 * 1024) {
        await sock.sendMessage(jid, {
          document: { url: tempFile },
          mimetype: "video/mp4",
          fileName: "galaxy-video-" + qualityLabel + ".mp4",
          caption: caption + "\nSent as document because file exceeds 180 MB."
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          video: { url: tempFile },
          mimetype: "video/mp4",
          fileName: "galaxy-video-" + qualityLabel + ".mp4",
          caption
        }, { quoted: message });
      }

      await editStatus("Download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] Video download failed:", error);
      try {
        await editStatus("Download failed. Please try again.");
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
