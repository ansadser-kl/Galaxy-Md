"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { downloadMediaMessage } = require("baileys");
const execFileAsync = promisify(execFile);

module.exports = {
  name: "sticker",
  aliases: [],
  description: "Convert a replied image to a sticker",
  category: "Media",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const current = message.message;
    const media = quoted?.imageMessage || current?.imageMessage;
    if (!media) {
      return sock.sendMessage(jid, { text: "Reply to an image with .sticker" }, { quoted: message });
    }

    const source = quoted
      ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted }
      : message;
    const input = path.join(os.tmpdir(), "galaxy-sticker-" + Date.now() + ".img");
    const output = input + ".webp";

    try {
      const buffer = await downloadMediaMessage(source, "buffer", {});
      fs.writeFileSync(input, buffer);
      await execFileAsync("ffmpeg", [
        "-y", "-i", input,
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-vcodec", "libwebp", "-lossless", "1", "-loop", "0", "-an",
        output
      ], { timeout: 120000 });
      await sock.sendMessage(jid, { sticker: fs.readFileSync(output) }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Sticker conversion failed:", error.message);
      await sock.sendMessage(jid, { text: "Sticker conversion failed. Check that FFmpeg is installed and supports libwebp: pkg install ffmpeg" }, { quoted: message });
    } finally {
      for (const file of [input, output]) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
  }
};
