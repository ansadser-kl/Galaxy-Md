"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_INPUT = 50 * 1024 * 1024;

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

// Audio message allenkil audio mime ulla document aano ennu nokkum
function isAudio(msg) {
  if (msg?.audioMessage) return "audioMessage";
  if (msg?.documentMessage && /^audio\//i.test(msg.documentMessage.mimetype || "")) return "documentMessage";
  return null;
}

function getQuotedAudio(message) {
  const own = unwrap(message?.message);
  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.audioMessage?.contextInfo ||
    own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);
  const type = isAudio(quoted);
  if (!quoted || !type) return null;

  return {
    node: quoted[type],
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

module.exports = {
  name: "black",
  aliases: [],
  description: "Convert a replied audio to a black-screen MP4 video",
  category: "Media",

  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    const audio = getQuotedAudio(message);
    if (!audio) {
      return send("Audio-yil reply cheythu .black ayakkuka.");
    }

    const id = Date.now() + "-" + Math.random().toString(16).slice(2);
    const input = path.join(os.tmpdir(), "galaxy-black-in-" + id);
    const output = path.join(os.tmpdir(), "galaxy-black-out-" + id + ".mp4");

    try {
      const declared = Number(audio.node?.fileLength?.low ?? audio.node?.fileLength ?? 0);
      if (declared > MAX_INPUT) throw new Error("File too large (max 50 MB).");

      const downloadMediaMessage = loadDownloader();
      const buffer = await downloadMediaMessage(audio.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Audio download returned empty data.");
      if (buffer.length > MAX_INPUT) throw new Error("File too large.");
      fs.writeFileSync(input, buffer);

      // Black video + reply cheytha audio; audio theernnaal video nirthum
      await run(FFMPEG, [
        "-y",
        "-f", "lavfi", "-i", "color=c=black:s=640x360:r=1",
        "-i", input,
        "-map", "0:v:0", "-map", "1:a:0",
        "-shortest",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "faststart",
        output,
      ], { timeout: 180000 });

      const video = fs.readFileSync(output);
      if (!video.length) throw new Error("FFmpeg produced an empty MP4 file.");

      await sock.sendMessage(jid, { video, mimetype: "video/mp4", caption: "" }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Black video failed:", error?.message || error);
      const reason = String(error?.message || error);
      if (/ENOENT|ffmpeg/i.test(reason)) {
        await send("❌ FFmpeg install cheyyuka: Ubuntu/VPS: sudo apt install ffmpeg -y | Termux: pkg install ffmpeg");
      } else {
        await send("❌ Black video failed.\n" + reason.slice(0, 200));
      }
    } finally {
      for (const file of [input, output]) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
    }
  },
};
