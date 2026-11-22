"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

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

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "Size unavailable";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return size.toFixed(unit === 0 ? 0 : 2) + " " + units[unit];
}

function safeFilename(value) {
  return String(value || "youtube-video")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100) || "youtube-video";
}

async function getVideoMetadata(url) {
  const { stdout } = await execFileAsync(
    YTDLP_BIN,
    ["--no-warnings", "--no-playlist", "--dump-single-json", url],
    {
      timeout: 60000,
      maxBuffer: 25 * 1024 * 1024
    }
  );
  return JSON.parse(stdout);
}

function extractQualityChoices(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const byHeight = new Map();

  for (const fmt of formats) {
    const height = Number(fmt?.height);
    const hasVideo = fmt?.vcodec && fmt.vcodec !== "none";
    if (!Number.isFinite(height) || height <= 0 || !hasVideo) continue;

    const rawSize = Number(fmt?.filesize || fmt?.filesize_approx || 0);
    const existing = byHeight.get(height);

    // Prefer mp4 / higher known filesize for the same resolution
    const scoreFmt = (f) => {
      let score = 0;
      if (f?.ext === "mp4") score += 10;
      if (f?.acodec && f.acodec !== "none") score += 5;
      if (Number(f?.filesize || f?.filesize_approx || 0) > 0) score += 3;
      return score;
    };

    if (!existing || scoreFmt(fmt) > scoreFmt(existing.fmt)) {
      byHeight.set(height, {
        height,
        quality: height + "p",
        size: rawSize > 0 ? formatBytes(rawSize) : "Size unavailable",
        fmt
      });
    }
  }

  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map(({ height, quality, size }) => ({ height, quality, size }));
}

module.exports = {
  name: "ytv",
  aliases: [],
  description: "Download YouTube video in selected quality using yt-dlp",
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
      await sock.sendMessage(
        jid,
        { text: "🔎 Getting available video qualities via yt-dlp..." },
        { quoted: message }
      );

      const info = await getVideoMetadata(url);
      const choices = extractQualityChoices(info);

      if (!choices.length) {
        throw new Error("No video formats found");
      }

      const videoId = info?.id || getVideoId(url);
      const title = String(info?.title || "YouTube video");
      const key = jid + ":" + senderId(message, jid);

      pendingChoices.set(key, {
        url,
        title,
        downloads: choices,
        createdAt: Date.now()
      });

      const lines = choices.map(
        (item, index) => (index + 1) + ". " + item.quality + " — " + item.size
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "🎬 *" + title.slice(0, 180) + "*\n" +
            "🆔 Video ID: " + videoId + "\n\n" +
            "📥 *Available video qualities*\n" +
            lines.join("\n") + "\n\n" +
            "Reply with the number of your preferred quality.\n" +
            "⏳ Selection expires in 10 minutes."
        },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .ytv metadata error:", error);
      await sock.sendMessage(
        jid,
        { text: "❌ Video quality list failed!\nyt-dlp error: " + (error?.message || "Unknown error") },
        { quoted: message }
      );
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
      await sock.sendMessage(
        jid,
        { text: "⌛ Quality selection expired. Please use .ytv again." },
        { quoted: message }
      );
      return true;
    }

    const index = Number(choice) - 1;
    if (index < 0 || index >= pending.downloads.length) {
      await sock.sendMessage(
        jid,
        { text: "❌ Invalid number. Reply with a number from 1 to " + pending.downloads.length + "." },
        { quoted: message }
      );
      return true;
    }

    const selected = pending.downloads[index];
    pendingChoices.delete(key);

    const tempBase = path.join(
      os.tmpdir(),
      "galaxy-ytv-" + Date.now() + "-" + Math.random().toString(16).slice(2)
    );
    const expectedOutput = tempBase + ".mp4";
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
        { text: "⬇️ Downloading " + selected.quality + " via yt-dlp..." },
        { quoted: message }
      );

      const formatSelector =
        `bv*[height<=${selected.height}]+ba/b[height<=${selected.height}]/bv*+ba/b`;

      await execFileAsync(
        YTDLP_BIN,
        [
          "--no-warnings",
          "--no-playlist",
          "-f",
          formatSelector,
          "--merge-output-format",
          "mp4",
          "-o",
          tempBase + ".%(ext)s",
          pending.url
        ],
        {
          timeout: 300000,
          maxBuffer: 25 * 1024 * 1024
        }
      );

      // Find produced file (usually tempBase.mp4)
      const outputFile = fs.existsSync(expectedOutput)
        ? expectedOutput
        : fs
            .readdirSync(os.tmpdir())
            .map((name) => path.join(os.tmpdir(), name))
            .find((fullPath) => fullPath.startsWith(tempBase + ".") && fs.statSync(fullPath).size > 0);

      if (!outputFile || !fs.existsSync(outputFile)) {
        throw new Error("Downloaded file not found");
      }

      const stats = fs.statSync(outputFile);
      if (!stats.size) {
        throw new Error("Downloaded file is empty");
      }

      await editStatus("📤 Sending " + selected.quality + "...");
      const sizeLimit = 180 * 1024 * 1024;
      const filename = safeFilename(pending.title) + ".mp4";

      if (stats.size > sizeLimit) {
        await sock.sendMessage(
          jid,
          {
            document: { url: outputFile },
            mimetype: "video/mp4",
            fileName: filename
          },
          { quoted: message }
        );
      } else {
        await sock.sendMessage(
          jid,
          {
            video: { url: outputFile },
            mimetype: "video/mp4",
            fileName: filename
          },
          { quoted: message }
        );
      }

      await editStatus("✅ Video download complete!");
    } catch (error) {
      console.error("[GALAXY-MD] .ytv download error:", error);
      await editStatus("❌ Video download failed!\nyt-dlp error: " + (error?.message || "Unknown error"));
    } finally {
      try {
        const dirFiles = fs.readdirSync(os.tmpdir());
        for (const name of dirFiles) {
          if (name.startsWith(path.basename(tempBase))) {
            fs.unlinkSync(path.join(os.tmpdir(), name));
          }
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete .ytv temp file:", err?.message);
      }
    }

    return true;
  }
};
