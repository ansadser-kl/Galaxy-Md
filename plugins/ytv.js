"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

function safeFilename(value) {
  return String(value || "youtube-video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100) || "youtube-video";
}

module.exports = {
  name: "ytv",
  aliases: [],
  description: "Download YouTube video in selected quality",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = input.match(/https?:\/\/\S+/i)?.[0]?.replace(/[)>]+$/, "");

    if (!url || !/(youtube\.com|youtu\.be)/i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid YouTube link!\nExample: .ytv https://youtu.be/VIDEO_ID" },
        { quoted: message }
      );
    }

    try {
      const statusMessage = await sock.sendMessage(
        jid,
        { text: "🔎 Getting available video qualities..." },
        { quoted: message }
      );

      const apiUrl = "https://yt-quality-api.vercel.app/api/ytmp4?url=" + encodeURIComponent(url);
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("API error");
      const data = await response.json();
      const result = data?.result;
      const downloads = Array.isArray(result?.downloads)
        ? result.downloads.filter(item => item && typeof item.url === "string" && item.url.trim())
        : [];

      if (data?.status !== true || !downloads.length) throw new Error("API error");

      const key = jid + ":" + senderId(message, jid);
      pendingChoices.set(key, {
        downloads,
        title: String(result.title || "YouTube video"),
        createdAt: Date.now(),
        statusKey: statusMessage.key
      });

      const lines = downloads.map((item, index) => (index + 1) + ". " + String(item.quality || "Unknown quality"));
      await sock.sendMessage(jid, {
        text: "🎬 *" + String(result.title || "YouTube video").slice(0, 180) + "*\n\n" +
          "Choose video quality by replying with its number:\n\n" +
          lines.join("\n") + "\n\n⏳ Reply within 10 minutes."
      }, { quoted: message });

    } catch (error) {
      console.error("[GALAXY-MD] .ytv error:", error);
      await sock.sendMessage(jid, { text: "❌ Video quality list failed!\nAPI error" }, { quoted: message });
    }
  },

  async handleReply({ sock, jid, message, text }) {
    const choice = String(text || "").trim();
    if (!/^\d+$/.test(choice)) return false;

    const key = jid + ":" + senderId(message, jid);
    const pending = pendingChoices.get(key);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > CHOICE_TTL) {
      pendingChoices.delete(key);
      await sock.sendMessage(jid, { text: "⌛ Quality selection expired. Please use .ytv again." }, { quoted: message });
      return true;
    }

    const index = Number(choice) - 1;
    if (index < 0 || index >= pending.downloads.length) {
      await sock.sendMessage(jid, {
        text: "❌ Invalid number. Reply with a number from 1 to " + pending.downloads.length + "."
      }, { quoted: message });
      return true;
    }

    const selected = pending.downloads[index];
    pendingChoices.delete(key);

    const tempFile = path.join(
      os.tmpdir(),
      "galaxy-ytv-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp4"
    );
    let statusMessage;

    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Failed to edit .ytv status:", err?.message);
      }
    };

    try {
      statusMessage = await sock.sendMessage(
        jid,
        { text: "⬇️ Downloading " + String(selected.quality || "video") + "..." },
        { quoted: message }
      );

      const response = await fetch(selected.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!response.ok || !response.body) throw new Error("API error");

      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("API error");

      await editStatus("📤 Sending " + String(selected.quality || "video") + "...");
      const sizeLimit = 180 * 1024 * 1024;
      const filename = safeFilename(pending.title) + ".mp4";

      if (stats.size > sizeLimit) {
        await sock.sendMessage(jid, {
          document: { url: tempFile },
          mimetype: "video/mp4",
          fileName: filename
        }, { quoted: message });
      } else {
        await sock.sendMessage(jid, {
          video: { url: tempFile },
          mimetype: "video/mp4",
          fileName: filename
        }, { quoted: message });
      }

      await editStatus("✅ Video download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] .ytv download error:", error);
      await editStatus("❌ Video download failed!\nAPI error");
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete .ytv temp file:", err?.message);
      }
    }

    return true;
  }
};
