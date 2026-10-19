"use strict";
const { downloadMediaMessage } = require("baileys");
const sharp = require("sharp");
module.exports = {
  name: "sticker",
  aliases: ["s", "st"],
  description: "Convert a replied image to a sticker",
  category: "Media",
  async execute({ sock, jid, message }) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const source = quoted ? { key: { remoteJid: jid, id: message.message.extendedTextMessage.contextInfo.stanzaId, participant: message.message.extendedTextMessage.contextInfo.participant }, message: quoted } : message;
    const media = source.message?.imageMessage || source.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    if (!media) return sock.sendMessage(jid, { text: "Reply to an image with .sticker" }, { quoted: message });
    const buffer = await downloadMediaMessage(source, "buffer", {});
    const webp = await sharp(buffer).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp().toBuffer();
    await sock.sendMessage(jid, { sticker: webp }, { quoted: message });
  }
};
