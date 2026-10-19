"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { downloadMediaMessage } = require("baileys");
const ffmpegPath = require("ffmpeg-static") || "ffmpeg";
const execFileAsync = promisify(execFile);
module.exports = {
  name: "mp4",
  aliases: [],
  description: "Convert an animated sticker to video or audio to a simple video",
  category: "Media",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const media = quoted || message.message;
    const sticker = media?.stickerMessage;
    const audio = media?.audioMessage;
    if (!sticker && !audio) return sock.sendMessage(jid, { text: "Reply to an animated sticker or audio with .mp4" }, { quoted: message });
    const source = quoted ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted } : message;
    const input = path.join(os.tmpdir(), "galaxy-" + Date.now() + (sticker ? ".webp" : ".audio"));
    const output = input + ".mp4";
    try {
      fs.writeFileSync(input, await downloadMediaMessage(source, "buffer", {}));
      if (sticker) {
        await execFileAsync(ffmpegPath, ["-y", "-i", input, "-movflags", "faststart", "-pix_fmt", "yuv420p", output], { timeout: 120000 });
      } else {
        await execFileAsync(ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=black:s=720x720:r=25", "-i", input, "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", output], { timeout: 120000 });
      }
      await sock.sendMessage(jid, { video: fs.readFileSync(output), caption: "Converted by GALAXY-MD" }, { quoted: message });
    } catch (e) {
      await sock.sendMessage(jid, { text: "MP4 conversion failed. Install FFmpeg in Termux with: pkg install ffmpeg" }, { quoted: message });
    } finally { for (const file of [input, output]) try { fs.unlinkSync(file); } catch {} }
  }
};
