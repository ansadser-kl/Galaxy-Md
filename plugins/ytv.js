"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

const API_BASE = process.env.YTV_API || "https://xenosirapis.zone.id/api/ytdlp";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

function getVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("/")[0] || "Unknown";
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "Unknown";
    const match = parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/);
    return match?.[1] || "Unknown";
  } catch {
    return "Unknown";
  }
}

function formatSize(mb) {
  const value = Number(mb);
  if (!Number.isFinite(value) || value <= 0) return "Size unavailable";
  if (value >= 1024) return (value / 1024).toFixed(2) + " GB";
  return value.toFixed(2) + " MB";
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + pad(m) + ":" + pad(sec) : m + ":" + pad(sec);
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

      const apiUrl = API_BASE + "?url=" + encodeURIComponent(url);
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) throw new Error("API error (" + response.status + ")");
      const data = await response.json();

      const downloads = Array.isArray(data?.video)
        ? data.video
            .filter(item => item && typeof item.downloadUrl === "string" && item.downloadUrl.trim())
            .map(item => ({
              quality: String(item.quality || "Unknown quality"),
              url: item.downloadUrl.trim(),
              size: formatSize(item.sizeMB)
            }))
            .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))
        : [];

      if (data?.status !== true || !downloads.length) throw new Error("No video qualities found");

      const videoId = data.id || getVideoId(url);
      const title = String(data.title || "YouTube video");
      const duration = formatDuration(data.duration);

      const key = jid + ":" + senderId(message, jid);
      pendingChoices.set(key, {
        downloads,
        title,
        createdAt: Date.now(),
        statusKey: statusMessage.key
      });

      const lines = downloads.map((item, index) =>
        (index + 1) + ". " + item.quality + " — " + item.size
      );
      await sock.sendMessage(jid, {
        text: "🎬 *" + title.slice(0, 180) + "*\n" +
          "🆔 Video ID: " + videoId + "\n" +
          (duration ? "⏱️ Duration: " + duration + "\n" : "") +
          "\n📥 *Available video qualities*\n" + lines.join("\n") + "\n\n" +
          "Reply with the number of your preferred quality.\n" +
          "⏳ Selection expires in 10 minutes."
      }, { quoted: message });

    } catch (error) {
      console.error("[GALAXY-MD] .ytv error:", error);
      await sock.sendMessage(jid, {
        text: "❌ Video quality list failed!\n" + String(error.message || "API error").slice(0, 200)
      }, { quoted: message });
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
        { text: "⬇️ Downloading " + selected.quality + "..." },
        { quoted: message }
      );

      const response = await fetch(selected.url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(300000)
      });

      if (!response.ok || !response.body) throw new Error("Download failed (" + response.status + ")");

      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempFile));
      const stats = fs.statSync(tempFile);
      if (!stats.size) throw new Error("Empty file");

      await editStatus("📤 Sending " + selected.quality + "...");
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
      await editStatus("❌ Video download failed!\n" + String(error.message || "API error").slice(0, 200));
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
