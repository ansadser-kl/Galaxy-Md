"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const baileys = require("baileys");
const downloadMediaMessage = baileys.downloadMediaMessage;

module.exports = {
  name: "fd",
  aliases: [],
  description: "Send replied audio as voice note to a JID/channel",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const targetJid = input.split(/\s+/)[0];
    if (!targetJid || !/^[0-9]+@(s\.whatsapp\.net|g\.us|newsletter)$/.test(targetJid)) {
      await sock.sendMessage(
        jid,
        { text: "Usage: reply to an audio and type .fd <jid>" },
        { quoted: message }
      );
      return;
    }

    const context = message?.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const quotedMessage = quoted
      ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted }
      : null;

    if (!quotedMessage || !(quoted.audioMessage || quoted.documentMessage?.mimetype?.startsWith("audio/"))) {
      await sock.sendMessage(
        jid,
        { text: "❌ Oru audio/voice note-inu reply cheythu .fd <jid> kodukkuka." },
        { quoted: message }
      );
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-fd-"));
    try {
      await sock.sendMessage(jid, { text: "🎙️ Converting & sending voice note..." }, { quoted: message });

      const audioBuffer = await downloadMediaMessage(
        quotedMessage,
        "buffer",
        {},
        { logger: console, reuploadRequest: sock.updateMediaMessage }
      );
      if (!audioBuffer || !audioBuffer.length) throw new Error("Audio download failed");

      const inputFile = path.join(tempDir, "input-audio");
      const outputFile = path.join(tempDir, "output.ogg");
      fs.writeFileSync(inputFile, audioBuffer);

      // Recipe 4: 128k vbr-on (without waveform/seconds metadata)
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i", inputFile,
          "-vn",
          "-map_metadata", "-1",
          "-c:a", "libopus",
          "-b:a", "128k",
          "-vbr", "on",
          "-compression_level", "10",
          "-ar", "48000",
          "-ac", "1",
          "-f", "ogg",
          outputFile
        ],
        { timeout: 180000 }
      );

      const buf = fs.readFileSync(outputFile);
      const payload = {
        audio: buf,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      };

      await sock.sendMessage(targetJid, payload);

      await sock.sendMessage(
        jid,
        { text: "✅ Voice note successfully sent!" },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .fd failed:", error);
      await sock.sendMessage(
        jid,
        { text: "❌ Failed: " + String(error?.message || error).slice(0, 180) },
        { quoted: message }
      );
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  },
};
