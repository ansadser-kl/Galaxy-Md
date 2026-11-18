"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_INPUT = 50 * 1024 * 1024;
const MEDIA_TYPES = ["audioMessage", "videoMessage", "documentMessage"];

function getMedia(message) {
  const unwrap = (m) =>
    m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
    m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message || m;

  const own = unwrap(message?.message);
  const ctx = own?.extendedTextMessage?.contextInfo || own?.audioMessage?.contextInfo ||
    own?.videoMessage?.contextInfo || own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);
  const pick = (m) => MEDIA_TYPES.find((t) => m?.[t]);

  if (quoted && pick(quoted)) {
    return {
      node: quoted[pick(quoted)],
      msg: {
        key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant },
        message: quoted
      }
    };
  }
  if (own && pick(own)) return { node: own[pick(own)], msg: message };
  return null;
}

async function loadDownloader() {
  for (const name of ["@whiskeysockets/baileys", "baileys"]) {
    try {
      const mod = require(name);
      if (mod.downloadMediaMessage) return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}

// Input words-il ninnu command word maattum
function getArgs(text, args) {
  const input = String(text || args?.join(" ") || "").trim();
  return input.split(/\s+/).filter(Boolean).slice(1);
}

// Reply cheytha audio-yil ffmpeg run cheyyum, output mp3 aayi send cheyyum
async function runEffect({ sock, jid, message, name, usage, buildArgs, values }) {
  const media = getMedia(message);
  if (!media) {
    return sock.sendMessage(jid, { text: "Audio/voice/video-kku reply cheythu " + usage }, { quoted: message });
  }

  const id = Date.now() + "-" + Math.random().toString(16).slice(2);
  const inFile = path.join(os.tmpdir(), "galaxy-" + name + "-in-" + id);
  const outFile = path.join(os.tmpdir(), "galaxy-" + name + "-out-" + id + ".mp3");
  let statusMessage;

  const editStatus = async (status) => {
    try {
      if (statusMessage?.key) await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
    } catch (err) {
      console.warn("[GALAXY-MD] Failed to edit " + name + " status:", err?.message);
    }
  };

  try {
    // Input check pehle, download pinne
    const ffArgs = buildArgs(values, inFile, outFile);

    statusMessage = await sock.sendMessage(jid, { text: "⏳ Processing..." }, { quoted: message });

    const downloadMediaMessage = await loadDownloader();
    const buffer = await downloadMediaMessage(media.msg, "buffer", {});
    if (!buffer?.length) throw new Error("Could not download the media.");
    if (buffer.length > MAX_INPUT) throw new Error("File too large.");
    fs.writeFileSync(inFile, buffer);

    await run(FFMPEG, ffArgs, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    if (!fs.statSync(outFile).size) throw new Error("ffmpeg output empty.");

    await sock.sendMessage(jid, {
      audio: { url: outFile },
      mimetype: "audio/mpeg",
      fileName: name + ".mp3",
      ptt: false
    }, { quoted: message });

    await editStatus("✅ Done!");
  } catch (error) {
    console.error("[GALAXY-MD] " + name + " failed:", error?.message || error);
    await editStatus("❌ Failed!\n" + String(error?.message || error).slice(0, 300));
  } finally {
    for (const f of [inFile, outFile]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
  }
}

module.exports = { getArgs, runEffect };
