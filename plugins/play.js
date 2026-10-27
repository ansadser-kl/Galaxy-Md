"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

module.exports = {
  name: "play",
  aliases: ["song"],
  description: "Search YouTube and download a song as MP3",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const query = String(text || args?.join(" ") || "").trim();

    if (!query) {
      return sock.sendMessage(
        jid,
        { text: "🎵 *Play / Song*\n\nEnter a song name.\nExample: .play Varnajaalam\nAlias: .song Varnajaalam" },
        { quoted: message }
      );
    }

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-play-" + Date.now() + "-" +
      Math.random().toString(16).slice(2) + ".mp3"
    );

    let statusMessage;
    const editStatus = async status => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (error) {
        console.warn("[GALAXY-MD] Failed to edit play status:", error?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "🎵 Searching for the song..." },
        { quoted: message }
      );

      const apiUrl = new URL("https://api-faa.my.id/faa/ytplay");
      apiUrl.searchParams.set("query", query);

      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("API error");

      const payload = await response.json();
      const result = payload?.result;

      if (payload?.status !== true ||
          typeof result?.mp3 !== "string" ||
          !/^https?:\/\//i.test(result.mp3)) {
        throw new Error("API error");
      }

      const title = String(result.title || query).trim().slice(0, 180);
      const channel = String(result.author || "").trim().slice(0, 100);
      const duration = String(result.duration_timestamp || result.duration || "").trim();
      const sourceUrl = typeof result.url === "string" && /^https?:\/\//i.test(result.url)
        ? result.url
        : "";
      const thumbnail = typeof result.thumbnail === "string" && /^https?:\/\//i.test(result.thumbnail)
        ? result.thumbnail
        : "";

      await editStatus("⬇️ Downloading MP3...");

      const downloadResponse = await fetch(result.mp3, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!downloadResponse.ok || !downloadResponse.body) throw new Error("API error");

      await pipeline(
        Readable.fromWeb(downloadResponse.body),
        fs.createWriteStream(tempFile)
      );

      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("API error");

      await editStatus("📤 Sending song...");

      const safeTitle = title
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "song";

      await sock.sendMessage(
        jid,
        {
          audio: { url: tempFile },
          mimetype: "audio/mpeg",
          fileName: safeTitle + ".mp3",
          ptt: false,
          ...(thumbnail
            ? { contextInfo: { externalAdReply: {
                title: title.slice(0, 100),
                body: channel || "YouTube",
                mediaType: 1,
                thumbnailUrl: thumbnail,
                sourceUrl: sourceUrl || undefined,
                renderLargerThumbnail: false
              } } }
            : {})
        },
        { quoted: message }
      );

      await editStatus("✅ Song sent successfully!");
    } catch (error) {
      console.error("[GALAXY-MD] play download failed:", error?.message || error);
      await editStatus("❌ Song download failed!\nAPI error");
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (error) {
        console.warn("[GALAXY-MD] Could not delete song temp file:", error?.message);
      }
    }
  }
};
