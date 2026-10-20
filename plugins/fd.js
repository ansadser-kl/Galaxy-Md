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
  description: "Send replied audio as a voice note to a target JID",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const targetJid = input.split(/\s+/)[0];
    if (!targetJid || !/^[0-9]+@(s\.whatsapp\.net|g\.us|newsletter)$/.test(targetJid)) {
      await sock.sendMessage(jid, { text: "Usage: reply to an audio and type .fd <jid>\nExample: .fd 120363412182028819@newsletter" }, { quoted: message });
      return;
    }
    const context = message?.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const quotedMessage = quoted ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted } : null;
    if (!quotedMessage || !(quoted.audioMessage || quoted.documentMessage?.mimetype?.startsWith("audio/"))) {
      await sock.sendMessage(jid, { text: "❌ Oru audio/voice note-inu reply cheythu .fd <jid> kodukkuka." }, { quoted: message });
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-fd-"));
    try {
      await sock.sendMessage(jid, { text: "🎙️ Audio voice note formatilekku convert cheyyunnu..." }, { quoted: message });
      const audioBuffer = await downloadMediaMessage(quotedMessage, "buffer", {}, { logger: console, reuploadRequest: sock.updateMediaMessage });
      if (!audioBuffer || !audioBuffer.length) throw new Error("Audio download failed");
      const inputFile = path.join(tempDir, "input-audio");
      const outputFile = path.join(tempDir, "voice-note.ogg");
      fs.writeFileSync(inputFile, audioBuffer);
      await execFileAsync("ffmpeg", ["-y", "-i", inputFile, "-vn", "-c:a", "libopus", "-b:a", "32k", "-vbr", "on", "-application", "voip", "-ac", "1", "-ar", "48000", outputFile], { timeout: 120000 });
      const voiceBuffer = fs.readFileSync(outputFile);
      if (!voiceBuffer.length) throw new Error("Audio conversion returned an empty file");
      await sock.sendMessage(targetJid, { audio: voiceBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
      await sock.sendMessage(jid, { text: "✅ Voice note target JID-lekk ayachu." }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] .fd failed:", error);
      await sock.sendMessage(jid, { text: "❌ Audio ayakkan pattiyilla: " + String(error?.message || error).slice(0, 180) }, { quoted: message });
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
};
