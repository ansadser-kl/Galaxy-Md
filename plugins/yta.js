"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "yta",
  aliases: ["audio"],
  description: "Download YouTube audio as MP3",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        {
          text: "Please provide a valid YouTube link!\nExample: .yta https://youtu.be/VIDEO_ID\nAlias: .audio <YouTube URL>"
        },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-yta-" + Date.now() + "-" +
      Math.random().toString(16).slice(2) + ".mp3"
    );

    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, {
            text: status,
            edit: statusMessage.key
          });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit status message:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🎵 Getting YouTube audio link..." },
        { quoted: message }
      );

      const apiUrl = "https://eliteprotech-apis.zone.id/download/ytmp3?url=" + encodeURIComponent(url);
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        throw new Error("EliteProTech API returned HTTP " + response.status);
      }

      const result = await response.json();

      if (result?.status !== true || typeof result?.download?.downloadUrl !== "string" || !result.download.downloadUrl.trim()) {
        throw new Error("EliteProTech API did not return a valid MP3 link.");
      }

      const downloadUrl = result.download.downloadUrl;
      const title = String(result.download.title || "youtube-audio");

      await editStatus("⬇️ Downloading MP3...");

      const downloadRes = await fetch(downloadUrl, {
        headers: {
          Referer: "https://eliteprotech-apis.zone.id/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!downloadRes.ok || !downloadRes.body) {
        throw new Error("MP3 download failed (HTTP " + downloadRes.status + ").");
      }

      await pipeline(
        Readable.fromWeb(downloadRes.body),
        fs.createWriteStream(tempFile)
      );

      const stats = fs.statSync(tempFile);
      if (!stats.size) {
        throw new Error("The downloaded MP3 file is empty.");
      }

      await editStatus("📤 Sending MP3...");

      const safeTitle = title
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 100) || "audio";

      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: safeTitle + ".mp3",
          ptt: false
        },
        { quoted: message }
      );

      await editStatus("✅ Download complete!");

    } catch (error) {
      console.error("[GALAXY-MD] YouTube audio download error:", error);

      await editStatus(
        "❌ Download failed!\n" +
        String(error?.message || error).slice(0, 180)
      );

    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete temp file:", err?.message);
      }
    }
  }
};
