"use strict";

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
    const quotedMessage = quoted ? {
      key: {
        remoteJid: jid,
        id: context.stanzaId,
        participant: context.participant
      },
      message: quoted
    } : null;

    if (!quotedMessage || !(quoted.audioMessage || quoted.documentMessage?.mimetype?.startsWith("audio/"))) {
      await sock.sendMessage(jid, { text: "❌ Oru audio/voice note-inu reply cheythu .fd <jid> kodukkuka." }, { quoted: message });
      return;
    }

    try {
      await sock.sendMessage(jid, { text: "🎙️ Audio voice note aayi ayakkunnu..." }, { quoted: message });
      const audioBuffer = await downloadMediaMessage(quotedMessage, "buffer", {}, {
        logger: console,
        reuploadRequest: sock.updateMediaMessage
      });
      if (!audioBuffer || !audioBuffer.length) throw new Error("Audio download failed");

      await sock.sendMessage(targetJid, {
        audio: audioBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt: true
      });
      await sock.sendMessage(jid, { text: "✅ Voice note target JID-lekk ayachu." }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] .fd failed:", error);
      await sock.sendMessage(jid, { text: "❌ Audio ayakkan pattiyilla. Bot log check cheyyuka." }, { quoted: message });
    }
  }
};
