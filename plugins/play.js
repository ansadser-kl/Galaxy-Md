"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "play",
  aliases: ["song"],
  description: "Search and download a song as MP3",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const query = String(text || args?.join(" ") || "").trim();

    if (!query) {
      return sock.sendMessage(
        jid,
        { text: "Please enter a song name!\nExample: .play Varnajaalam betleham\nAlias: .song <song name>" },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-play-" + Date.now() + "-" +
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
        console.warn("[GALAXY-MD] Failed to edit song status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🎵 Searching for the song..." },
        { quoted: message }
      );

      const apiUrl = "https://zellrayy.com/download/ytplaymusic/v2?q=" + encodeURIComponent(query);
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0"
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        throw new Error("API error");
      }

      const result = await response.json();

      if (result?.status !== true || typeof result?.result?.download !== "string" || !result.result.download.trim()) {
        throw new Error("API error");
      }

      const downloadUrl = result.result.download;
      const title = String(result.result.title || query);

      await editStatus("⬇️ Downloading MP3...");

      const downloadRes = await fetch(downloadUrl, {
        headers: {
          Referer: "https://zellrayy.com/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!downloadRes.ok || !downloadRes.body) {
        throw new Error("API error");
      }

      await pipeline(
        Readable.fromWeb(downloadRes.body),
        fs.createWriteStream(tempFile)
      );

      const stats = fs.statSync(tempFile);
      if (!stats.size) {
        throw new Error("API error");
      }

      await editStatus("📤 Sending song...");

      const safeTitle = title
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim()
        .slice(0, 100) || "song";

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

      await editStatus("✅ Song sent successfully!");

    } catch (error) {
      console.error("[GALAXY-MD] song download error:", error);
      await editStatus("❌ Song download failed!\nAPI error");
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete song temp file:", err?.message);
      }
    }
  }
};
