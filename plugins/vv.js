"use strict";
const { downloadMediaMessage } = require("baileys");
module.exports = {
  name: "vv",
  aliases: [],
  description: "Retrieve view-once media when replying to it",
  category: "Media",
  async execute({ sock, jid, message }) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return sock.sendMessage(jid, { text: "Reply to a view-once photo/video with .vv" }, { quoted: message });
    const context = message.message.extendedTextMessage.contextInfo;
    const source = { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted };
    const media = quoted.imageMessage || quoted.videoMessage;
    if (!media) return sock.sendMessage(jid, { text: "That reply doesn't contain a photo/video." }, { quoted: message });
    const buffer = await downloadMediaMessage(source, "buffer", {});
    if (media.mimetype?.startsWith("video/")) {
      await sock.sendMessage(jid, { video: buffer, caption: media.caption || "" }, { quoted: message });
    } else {
      await sock.sendMessage(jid, { image: buffer, caption: media.caption || "" }, { quoted: message });
    }
  }
};
