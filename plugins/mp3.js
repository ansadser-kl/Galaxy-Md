"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { downloadMediaMessage } = require("baileys");
const ffmpegPath = "ffmpeg";
const execFileAsync = promisify(execFile);
module.exports = {
  name: "mp3",
  aliases: [],
  description: "Extract audio from a replied video",
  category: "Media",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    if (!quoted?.videoMessage && !message.message?.videoMessage) return sock.sendMessage(jid, { text: "Reply to a video with .mp3" }, { quoted: message });
    const source = quoted ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted } : message;
    const input = path.join(os.tmpdir(), "galaxy-" + Date.now() + ".mp4");
    const output = input.replace(/\.mp4$/, ".mp3");
    try {
      fs.writeFileSync(input, await downloadMediaMessage(source, "buffer", {}));
      await execFileAsync(ffmpegPath, ["-y", "-i", input, "-vn", "-codec:a", "libmp3lame", "-q:a", "4", output], { timeout: 120000 });
      await sock.sendMessage(jid, { audio: fs.readFileSync(output), mimetype: "audio/mpeg", fileName: "audio.mp3" }, { quoted: message });
    } catch (e) {
      await sock.sendMessage(jid, { text: "MP3 conversion failed. Install FFmpeg in Termux with: pkg install ffmpeg" }, { quoted: message });
    } finally { for (const file of [input, output]) try { fs.unlinkSync(file); } catch {} }
  }
};
