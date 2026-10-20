"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const baileys = require("baileys");
const downloadMediaMessage = baileys.downloadMediaMessage;
const execFileAsync = promisify(execFile);

module.exports = {
  name: "sticker",
  aliases: [],
  description: "Convert replied images and short videos to stickers",
  category: "Media",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const current = message.message;
    const media = quoted?.imageMessage || quoted?.videoMessage ||
      quoted?.documentMessage || current?.imageMessage || current?.videoMessage;

    if (!media || (!media.mimetype?.startsWith("image/") && !media.mimetype?.startsWith("video/") &&
      !(quoted?.imageMessage || current?.imageMessage) && !(quoted?.videoMessage || current?.videoMessage))) {
      return sock.sendMessage(
        jid,
        { text: "Reply to an image or video with .sticker (short videos only)." },
        { quoted: message }
      );
    }

    const source = quoted
      ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted }
      : message;
    const isVideo = Boolean(quoted?.videoMessage || current?.videoMessage ||
      (quoted?.documentMessage?.mimetype || "").startsWith("video/"));
    const input = path.join(os.tmpdir(), "galaxy-sticker-" + Date.now() + (isVideo ? ".mp4" : ".img"));
    const output = input + ".webp";

    try {
      const buffer = await downloadMediaMessage(source, "buffer", {});
      fs.writeFileSync(input, buffer);

      const args = ["-y", "-i", input];
      if (isVideo) {
        args.push(
          "-t", "6",
          "-vf", "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
          "-an", "-vcodec", "libwebp", "-lossless", "0", "-q:v", "50",
          "-loop", "0", "-preset", "default", "-vsync", "0",
          "-fs", "500K"
        );
      } else {
        args.push(
          "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
          "-vcodec", "libwebp", "-lossless", "1", "-loop", "0", "-an"
        );
      }
      args.push(output);

      await execFileAsync("ffmpeg", args, { timeout: 120000, maxBuffer: 1024 * 1024 });
      await sock.sendMessage(jid, { sticker: fs.readFileSync(output) }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Sticker conversion failed:", error.message);
      await sock.sendMessage(
        jid,
        { text: "Sticker conversion failed. Try a shorter video (maximum 6 seconds) and check FFmpeg is installed with libwebp support." },
        { quoted: message }
      );
    } finally {
      for (const file of [input, output]) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
  }
};
