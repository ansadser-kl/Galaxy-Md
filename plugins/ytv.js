"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const COOKIES = process.env.YTDLP_COOKIES || path.join(process.cwd(), "cookies.txt");
const MAX_HEIGHT = 1080;

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

function baseArgs() {
  const args = ["--no-playlist", "--no-warnings", "--js-runtimes", "node"];
  if (fs.existsSync(COOKIES)) args.push("--cookies", COOKIES);
  return args;
}

function runYtdlp(args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      args,
      { maxBuffer: 100 * 1024 * 1024, timeout },
      (error, stdout, stderr) => {
        if (error) {
          error.message = (stderr || error.message || "yt-dlp error").toString().trim().slice(-500);
          return reject(error);
        }
        resolve(stdout);
      }
    );
  });
}

// yt-dlp JSON-ൽ നിന്ന് ക്വാളിറ്റി ലിസ്റ്റ് ഉണ്ടാക്കുന്നു
function buildChoices(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const fsize = (f) => Number(f.filesize || f.filesize_approx || 0);

  const audioOnly = formats.filter(f => f.vcodec === "none" && f.acodec && f.acodec !== "none");
  const bestAudio = audioOnly
    .filter(f => f.ext === "m4a")
    .sort((a, b) => fsize(b) - fsize(a))[0] || audioOnly.sort((a, b) => fsize(b) - fsize(a))[0];
  const audioSize = bestAudio ? fsize(bestAudio) : 0;

  const videos = formats.filter(f =>
    f.vcodec && f.vcodec !== "none" && Number(f.height) > 0 && Number(f.height) <= MAX_HEIGHT
  );

  const byHeight = new Map();
  for (const f of videos) {
    const list = byHeight.get(f.height) || [];
    list.push(f);
    byHeight.set(f.height, list);
  }

  const choices = [];
  for (const [height, list] of byHeight) {
    const preferred =
      list.find(f => String(f.vcodec).startsWith("avc1")) ||
      list.find(f => f.ext === "mp4") ||
      list[0];
    let total = fsize(preferred);
    const hasAudio = preferred.acodec && preferred.acodec !== "none";
    if (total && !hasAudio) total += audioSize;
    choices.push({
      height,
      quality: height + "p",
      size: total ? "~" + formatBytes(total) : "Size unavailable"
    });
  }

  return choices.sort((a, b) => b.height - a.height);
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

      const stdout = await runYtdlp([...baseArgs(), "-J", url], 90000);
      const info = JSON.parse(stdout);
      const choices = buildChoices(info);

      if (!choices.length) throw new Error("No video formats found");

      const videoId = info.id || getVideoId(url);
      const title = String(info.title || "YouTube video");

      const key = jid + ":" + senderId(message, jid);
      pendingChoices.set(key, {
        url,
        downloads: choices,
        title,
        createdAt: Date.now(),
        statusKey: statusMessage.key
      });

      const lines = choices.map((item, index) =>
        (index + 1) + ". " + item.quality + " — " + item.size
      );
      await sock.sendMessage(jid, {
        text: "🎬 *" + title.slice(0, 180) + "*\n" +
          "🆔 Video ID: " + videoId + "\n\n" +
          "📥 *Available video qualities*\n" + lines.join("\n") + "\n\n" +
          "Reply with the number of your preferred quality.\n" +
          "⏳ Selection expires in 10 minutes."
      }, { quoted: message });

    } catch (error) {
      console.error("[GALAXY-MD] .ytv error:", error);
      await sock.sendMessage(jid, {
        text: "❌ Video quality list failed!\n" + String(error.message || "yt-dlp error").slice(0, 200)
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

    const tmpDir = os.tmpdir();
    const prefix = "galaxy-ytv-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    const outTemplate = path.join(tmpDir, prefix + ".%(ext)s");
    let tempFile = null;
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

      const h = selected.height;
      const formatSelector =
        "bv*[height<=" + h + "][vcodec^=avc1]+ba[ext=m4a]/" +
        "bv*[height<=" + h + "][ext=mp4]+ba[ext=m4a]/" +
        "b[height<=" + h + "][ext=mp4]/" +
        "b[height<=" + h + "]";

      await runYtdlp([
        ...baseArgs(),
        "-f", formatSelector,
        "--merge-output-format", "mp4",
        "-o", outTemplate,
        pending.url
      ], 15 * 60 * 1000);

      const found = fs.readdirSync(tmpDir).find(
        name => name.startsWith(prefix) && !name.endsWith(".part") && !name.endsWith(".ytdl")
      );
      if (!found) throw new Error("Downloaded file not found");
      tempFile = path.join(tmpDir, found);

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
      await editStatus("❌ Video download failed!\n" + String(error.message || "yt-dlp error").slice(0, 200));
    } finally {
      try {
        for (const name of fs.readdirSync(tmpDir)) {
          if (name.startsWith(prefix)) fs.unlinkSync(path.join(tmpDir, name));
        }
      } catch (err) {
        console.warn("[GALAXY-MD] Could not delete .ytv temp file:", err?.message);
      }
    }

    return true;
  }
};
