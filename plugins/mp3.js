"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

module.exports = {
  name: "mp3",
  aliases: [],
  description: "Extract audio from a replied video",
  category: "Media",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const current = message.message;
    const video = quoted?.videoMessage || current?.videoMessage;

    if (!video) {
      return sock.sendMessage(
        jid,
        { text: "Reply to a video with .mp3, or send a video with the caption .mp3." },
        { quoted: message }
      );
    }

    const source = quoted
      ? {
          key: {
            remoteJid: jid,
            id: context.stanzaId,
            participant: context.participant || message.key?.participant,
            fromMe: false
          },
          message: quoted
        }
      : message;

    const input = path.join(os.tmpdir(), "galaxy-" + Date.now() + ".mp4");
    const output = input.replace(/\.mp4$/, ".mp3");

    try {
      // Baileys v7 is ESM; load its media helper dynamically.
      const baileys = await import("baileys");
      const downloadMediaMessage = baileys.downloadMediaMessage;
      if (typeof downloadMediaMessage !== "function") {
        throw new Error("downloadMediaMessage export is unavailable in the installed Baileys version.");
      }

      const buffer = await downloadMediaMessage(source, "buffer", {});
      if (!buffer || !buffer.length) throw new Error("Video download returned empty data.");
      fs.writeFileSync(input, buffer);
      // Many videos contain no audio track; detect this before conversion.
      const probe = await execFileAsync("ffmpeg", ["-i", input], { timeout: 30000 }).catch((error) => error);
      const probeText = String(probe.stderr || probe.message || "");
      if (!/Audio:/.test(probeText)) {
        throw new Error("This video has no audio track, so it cannot be converted to MP3. Try a video that has sound.");
      }

      await execFileAsync("ffmpeg", [
        "-y", "-i", input, "-vn", "-map", "0:a:0?", "-codec:a", "libmp3lame", "-q:a", "4", output
      ], { timeout: 120000 });

      const audio = fs.readFileSync(output);
      if (!audio.length) throw new Error("FFmpeg produced an empty MP3 file.");

      await sock.sendMessage(
        jid,
        { audio, mimetype: "audio/mpeg", fileName: "audio.mp3" },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] MP3 conversion failed:", error);
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
        try { fs.unlinkSync(file); } catch {}
      }
    }
  }
};
