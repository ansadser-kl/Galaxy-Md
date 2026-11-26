"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

let webpMux = null;
try {
  webpMux = require("node-webpmux");
} catch {
  webpMux = null;
}

let ffmpegStaticPath = null;
try {
  ffmpegStaticPath = require("ffmpeg-static");
} catch {
  ffmpegStaticPath = null;
}

const DEFAULT_IMAGE = "https://galaxy-md-w3vr.onrender.com/dl/aseycE24EVyt";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function getFfmpegBin() {
  return process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
}

function tmpFilePath(ext = ".bin") {
  const name = `galaxy_take_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  return path.join(os.tmpdir(), name);
}

async function removeFiles(...files) {
  await Promise.all(
    files.filter(Boolean).map((f) => fs.promises.unlink(f).catch(() => {}))
  );
}

function unwrapMessage(msg) {
  let current = msg || {};
  for (let i = 0; i < 6; i++) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function getQuotedMessage(message) {
  const msg = unwrapMessage(message?.message);
  const ctx =
    msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    msg.audioMessage?.contextInfo ||
    msg.stickerMessage?.contextInfo ||
    msg.documentMessage?.contextInfo;

  if (!ctx?.quotedMessage) return null;

  return {
    key: {
      remoteJid: message.key.remoteJid,
      fromMe: Boolean(ctx.participant && ctx.participant === message.key.participant),
      id: ctx.stanzaId,
      ...(ctx.participant ? { participant: ctx.participant } : {}),
    },
    message: unwrapMessage(ctx.quotedMessage),
  };
}

function getMediaInfo(quoted) {
  const m = unwrapMessage(quoted?.message);
  if (!m) return null;

  if (m.stickerMessage) {
    return { type: "sticker", mediaKey: "stickerMessage", content: m.stickerMessage };
  }
  if (m.audioMessage) {
    return { type: "audio", mediaKey: "audioMessage", content: m.audioMessage };
  }
  return null;
}

async function downloadMediaBuffer(sock, quoted, mediaInfo) {
  const { downloadContentFromMessage } = require("baileys");
  const streamType = mediaInfo.type === "sticker" ? "sticker" : "audio";
  const stream = await downloadContentFromMessage(mediaInfo.content, streamType);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = getFfmpegBin();
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr = [];
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("error", (err) => reject(new Error(`FFmpeg start error: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`FFmpeg exited with ${code}: ${Buffer.concat(stderr).toString().trim()}`));
      }
      resolve();
    });
  });
}

async function setStickerExif(webpBuffer, { packname, author, emojis = ["😂"] }) {
  if (!webpMux?.Image) {
    return webpBuffer;
  }

  const img = new webpMux.Image();
  await img.load(webpBuffer);

  const json = {
    "sticker-pack-id": crypto.randomBytes(16).toString("hex"),
    "sticker-pack-name": packname || "GALAXY-MD",
    "sticker-pack-publisher": author || "ANSAD SER",
    emojis: Array.isArray(emojis) && emojis.length ? emojis : ["😂"],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuff = Buffer.from(JSON.stringify(json), "utf8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  img.exif = exif;
  return await img.save(null);
}

async function fetchImageBuffer(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http/https image URLs are supported");
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Empty image buffer");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5MB limit");
  return buf;
}

async function applyAudioMetadata(audioBuffer, { title, artist, coverBuffer }) {
  const inputAudio = tmpFilePath(".ogg");
  const outputAudio = tmpFilePath(".mp3");
  const coverPath = coverBuffer ? tmpFilePath(".jpg") : null;

  try {
    await fs.promises.writeFile(inputAudio, audioBuffer);
    if (coverBuffer && coverPath) {
      await fs.promises.writeFile(coverPath, coverBuffer);
    }

    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", inputAudio];
    if (coverPath) {
      args.push("-i", coverPath, "-map", "0:a", "-map", "1:v", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-map", "0:a");
    }

    args.push("-c:a", "libmp3lame", "-b:a", "192k");
    if (title) args.push("-metadata", `title=${title}`);
    if (artist) args.push("-metadata", `artist=${artist}`);
    args.push(outputAudio);

    await runFfmpeg(args);
    return await fs.promises.readFile(outputAudio);
  } finally {
    await removeFiles(inputAudio, outputAudio, coverPath);
  }
}

module.exports = {
  name: "take",
  aliases: [],
  category: "edit",
  description: "Change sticker pack/author or audio metadata and cover",

  async execute({ sock, jid, message, args = [], text = "", config = {} }) {
    const quoted = getQuotedMessage(message);
    const mediaInfo = getMediaInfo(quoted);

    if (!mediaInfo) {
      await sock.sendMessage(
        jid,
        { text: "Reply to a *sticker* or *audio* with `.take pack;author` or `.take title;artist;imageUrl`." },
        { quoted: message }
      );
      return;
    }

    const rawInput = String(text || args.join(" ") || "").trim();

    if (mediaInfo.type === "sticker") {
      const defaultStickerData = String(config.STICKER_DATA || config.stickerData || "GALAXY-MD;ANSAD SER");
      const [defPack, defAuthor] = defaultStickerData.split(";").map((s) => (s || "").trim());

      let packname = defPack || "GALAXY-MD";
      let author = defAuthor || "ANSAD SER";

      if (rawInput) {
        if (rawInput.includes(";")) {
          const [p, a] = rawInput.split(";");
          packname = (p || "").trim() || packname;
          author = (a || "").trim() || author;
        } else {
          packname = rawInput;
          author = "";
        }
      }

      try {
        const rawSticker = await downloadMediaBuffer(sock, quoted, mediaInfo);
        const emojis = mediaInfo.content?.emojis || ["😂"];
        const updatedSticker = await setStickerExif(rawSticker, { packname, author, emojis });

        await sock.sendMessage(
          jid,
          { sticker: updatedSticker },
          { quoted: quoted }
        );
      } catch (err) {
        console.error("[GALAXY-MD] take sticker error:", err?.message || err);
        await sock.sendMessage(
          jid,
          { text: `Failed to update sticker: ${err?.message || err}` },
          { quoted: message }
        );
      }
      return;
    }

    if (mediaInfo.type === "audio") {
      const parts = rawInput ? rawInput.split(";").map((s) => s.trim()) : [];
      const title = parts[0] || config.botName || "GALAXY-MD";
      const artist = parts[1] || config.ownerName || "ANSAD SER";
      const coverUrl = parts[2] || config.ALIVE_URL || DEFAULT_IMAGE;

      try {
        const rawAudio = await downloadMediaBuffer(sock, quoted, mediaInfo);
        let coverBuffer = null;
        if (coverUrl) {
          coverBuffer = await fetchImageBuffer(coverUrl).catch(() => null);
        }

        const processedAudio = await applyAudioMetadata(rawAudio, {
          title,
          artist,
          coverBuffer,
        });

        await sock.sendMessage(
          jid,
          {
            audio: processedAudio,
            mimetype: "audio/mpeg",
            ptt: false,
          },
          { quoted: quoted }
        );
      } catch (err) {
        console.error("[GALAXY-MD] take audio error:", err?.message || err);
        await sock.sendMessage(
          jid,
          { text: `Failed to update audio: ${err?.message || err}` },
          { quoted: message }
        );
      }
    }
  },
};
