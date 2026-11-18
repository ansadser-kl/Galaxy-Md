"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const ANIM_DUMP = process.env.ANIM_DUMP_PATH || "anim_dump";
const MAX_INPUT = 20 * 1024 * 1024;
const FPS = 15;

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

// Animated WebP-yude frames PNG aayi dump cheyyum (libwebp tools: anim_dump)
async function dumpFrames(input, folder) {
  fs.mkdirSync(folder, { recursive: true });
  await run(ANIM_DUMP, ["-folder", folder, "-prefix", "f_", input], { timeout: 60000 });
  const frames = fs.readdirSync(folder).filter((f) => f.endsWith(".png")).sort();
  if (!frames.length) throw new Error("anim_dump frames undaakkiyilla.");
  return frames;
}

function ffmpegErrorText(error) {
  if (error?.code === "ENOENT") {
    return "Install cheyyuka: sudo apt install ffmpeg webp -y";
  }
  const stderr = String(error?.stderr || "").trim().split("\n").slice(-4).join("\n");
  return stderr || String(error?.message || error).slice(0, 300);
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
    const framesDir = path.join(os.tmpdir(), "galaxy-mp4-frames-" + id);
    const output = path.join(os.tmpdir(), "galaxy-mp4-out-" + id + ".mp4");

    try {
      const downloadMediaMessage = loadDownloader();
      const buffer = await downloadMediaMessage(sticker.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Sticker download returned empty data.");
      if (buffer.length > MAX_INPUT) throw new Error("Sticker too large.");

      if (sticker.node.isAnimated === false || !isAnimatedWebp(buffer)) {
        return send("Ith animated sticker alla, static sticker aanu. Animation ulla sticker-il reply cheyyuka.");
      }
      fs.writeFileSync(input, buffer);

      const frames = await dumpFrames(input, framesDir);
      const firstName = frames[0];
      const realPattern = path.join(framesDir, firstName.replace(/\d+(?=\.png$)/, "%0" + firstName.match(/\d+(?=\.png$)/)[0].length + "d"));

      await run(FFMPEG, [
        "-y",
        "-framerate", String(FPS),
        "-i", realPattern,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "faststart",
        "-an",
        output,
      ], { timeout: 120000 });

      const video = fs.readFileSync(output);
      if (!video.length) throw new Error("MP4 output empty.");

      await sock.sendMessage(jid, { video, mimetype: "video/mp4", caption: "" }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] MP4 conversion failed:", error?.message || error);
      const code = error?.code === "ENOENT" ? "anim_dump illa" : "";
      await send("❌ MP4 conversion failed.\n" + (code || "") + ffmpegErrorText(error));
    } finally {
      try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
      for (const file of [input, output]) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
    }
  },
};
