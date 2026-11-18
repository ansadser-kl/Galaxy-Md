"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_INPUT = 20 * 1024 * 1024;

function unwrap(m) {
  let cur = m || {};
  for (let i = 0; i < 6; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// WebP file-il "ANIM" chunk undengil animated aanu (RIFF header)
function isAnimatedWebp(buf) {
  if (!buf || buf.length < 16) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return false;
  return buf.indexOf("ANIM", 12, "ascii") !== -1;
}

function getQuotedSticker(message) {
  const own = unwrap(message?.message);
  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.stickerMessage?.contextInfo ||
    own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);
  if (!quoted?.stickerMessage) return null;

  return {
    node: quoted.stickerMessage,
    msg: {
      key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
      message: quoted,
    },
  };
}

function loadDownloader() {
  for (const name of ["baileys", "@whiskeysockets/baileys"]) {
    try {
      const mod = require(name);
      if (typeof mod.downloadMediaMessage === "function") return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}


// ffmpeg binary illaatha error (ENOENT) matram install msg; baaki ffmpeg-inte real error kaanikkum
function ffmpegErrorText(error) {
  if (error?.code === "ENOENT") {
    return "FFmpeg install cheyyuka: Ubuntu/VPS: sudo apt install ffmpeg -y | Termux: pkg install ffmpeg";
  }
  const stderr = String(error?.stderr || "").trim().split("\n").slice(-4).join("\n");
  return "FFmpeg error:\n" + (stderr || String(error?.message || error)).slice(0, 300);
}

module.exports = {
  name: "mp4",
  aliases: [],
  description: "Convert a replied animated sticker to MP4 video",
  category: "Media",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    const sticker = getQuotedSticker(message);
    if (!sticker) {
      return send("Animated sticker-il reply cheythu .mp4 ayakkuka.");
    }

    const id = Date.now() + "-" + Math.random().toString(16).slice(2);
    const input = path.join(os.tmpdir(), "galaxy-mp4-in-" + id + ".webp");
    const output = path.join(os.tmpdir(), "galaxy-mp4-out-" + id + ".mp4");

    try {
      const downloadMediaMessage = loadDownloader();
      const buffer = await downloadMediaMessage(sticker.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Sticker download returned empty data.");
      if (buffer.length > MAX_INPUT) throw new Error("Sticker too large.");

      // Static sticker aano nokkum: animated alla enkil convert cheyyilla
      if (sticker.node.isAnimated === false || !isAnimatedWebp(buffer)) {
        return send("Ith animated sticker alla, static sticker aanu. Animation ulla sticker-il reply cheyyuka.");
      }

      fs.writeFileSync(input, buffer);

      // Even dimension + yuv420p venam MP4-kku
      await run(FFMPEG, [
        "-y", "-i", input,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-movflags", "faststart",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-an",
        output,
      ], { timeout: 120000 });

      const video = fs.readFileSync(output);
      if (!video.length) throw new Error("FFmpeg produced an empty MP4 file.");

      await sock.sendMessage(jid, { video, mimetype: "video/mp4", caption: "" }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] MP4 conversion failed:", error?.message || error);
      const reason = String(error?.message || error);
      if (/Ith animated|static sticker/i.test(reason)) {
        await send(reason);
      } else {
        await send("❌ MP4 conversion failed.\n" + ffmpegErrorText(error));
      }
    } finally {
      for (const file of [input, output]) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
    }
  },
};
