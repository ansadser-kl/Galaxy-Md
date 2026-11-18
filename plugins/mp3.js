"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_INPUT = 100 * 1024 * 1024;
// Ivide ulla type-kal ellaam MP3 aakkum: video, audio, voice note, m4a, document
const MEDIA_TYPES = ["videoMessage", "audioMessage", "documentMessage"];

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

// Media file aano ennu nokkum (document aanenkil audio/video mime venam)
function isConvertible(msg) {
  const type = MEDIA_TYPES.find((t) => msg?.[t]);
  if (!type) return null;
  if (type === "documentMessage") {
    const mime = String(msg.documentMessage.mimetype || "");
    if (!/^(audio|video)\//i.test(mime)) return null;
  }
  return type;
}

// Reply cheytha message allenkil ayachathu thanne media aano nokkum
function getSource(message) {
  const own = unwrap(message?.message);
  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.videoMessage?.contextInfo ||
    own?.audioMessage?.contextInfo ||
    own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);

  if (quoted && isConvertible(quoted)) {
    return {
      type: isConvertible(quoted),
      msg: {
        key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
        message: quoted,
      },
    };
  }
  if (own && isConvertible(own)) {
    return { type: isConvertible(own), msg: message };
  }
  return null;
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
  name: "mp3",
  aliases: [],
  description: "Convert replied video/audio/voice/m4a/document to MP3",
  category: "Media",

  async execute({ sock, jid, message }) {
    const source = getSource(message);
    if (!source) {
      return sock.sendMessage(
        jid,
        { text: "Video, audio, voice note, m4a allenkil audio document-ilekku reply cheythu .mp3 ayakkuka." },
        { quoted: message }
      );
    }

    const id = Date.now() + "-" + Math.random().toString(16).slice(2);
    const input = path.join(os.tmpdir(), "galaxy-mp3-in-" + id);
    const output = path.join(os.tmpdir(), "galaxy-mp3-out-" + id + ".mp3");

    try {
      const node = source.msg.message[source.type];
      const declared = Number(node?.fileLength?.low ?? node?.fileLength ?? 0);
      if (declared > MAX_INPUT) throw new Error("File too large (max 100 MB).");

      const downloadMediaMessage = loadDownloader();
      const buffer = await downloadMediaMessage(source.msg, "buffer", {});
      if (!buffer?.length) throw new Error("Media download returned empty data.");
      if (buffer.length > MAX_INPUT) throw new Error("File too large.");
      fs.writeFileSync(input, buffer);

      // Audio track illaatha video aano ennu nokkum
      const probe = await execFileAsync(FFMPEG, ["-i", input], { timeout: 30000 }).catch((e) => e);
      const probeText = String(probe.stderr || probe.message || "");
      if (!/Audio:/.test(probeText)) {
        throw new Error("Ee file-il audio track illa, athukondu MP3 aakkaan pattilla.");
      }

      await execFileAsync(FFMPEG, [
        "-y", "-i", input, "-vn", "-map", "0:a:0", "-codec:a", "libmp3lame", "-b:a", "192k", output,
      ], { timeout: 180000 });

      const audio = fs.readFileSync(output);
      if (!audio.length) throw new Error("FFmpeg produced an empty MP3 file.");

      await sock.sendMessage(
        jid,
        { audio, mimetype: "audio/mpeg", fileName: "audio.mp3", ptt: false },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] MP3 conversion failed:", error?.message || error);
      const reason = String(error?.message || error);
      let help = "❌ MP3 conversion failed.";
      if (/ffmpeg|enoent/i.test(reason)) {
        help += "\nFFmpeg install cheyyuka: Ubuntu/VPS: sudo apt install ffmpeg -y | Termux: pkg install ffmpeg";
      } else {
        help += "\n" + reason.slice(0, 250);
      }
      await sock.sendMessage(jid, { text: help }, { quoted: message });
    } finally {
      for (const file of [input, output]) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
    }
  },
};
