"use strict";

const { downloadMediaMessage } = require("baileys");

module.exports = {
  name: "save",
  aliases: [],
  description: "Send a replied message to your DM",
  category: "Utility",
  async execute({ sock, jid, message }) {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;

    if (!quoted || !context?.stanzaId) {
      return sock.sendMessage(
        jid,
        { text: "Reply to a message with .save to send it to your DM." },
        { quoted: message }
      );
    }

    const sender = message.key?.participant || message.key?.participantAlt || message.key?.remoteJid;
    if (!sender || sender === "status@broadcast" || sender.endsWith("@g.us")) {
      return sock.sendMessage(jid, { text: "Couldn't identify your DM." }, { quoted: message });
    }

    const source = {
      key: {
        remoteJid: jid,
        id: context.stanzaId,
        participant: context.participant || message.key?.participant
      },
      message: quoted
    };

    try {
      const msg = quoted;
      const text = msg.conversation || msg.extendedTextMessage?.text;
      if (text) {
        await sock.sendMessage(sender, { text });
      } else {
        const mediaType = [
          "imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"
        ].find((type) => msg[type]);

        if (!mediaType) {
          return sock.sendMessage(jid, { text: "This message type isn't supported by .save yet." }, { quoted: message });
        }

        const media = msg[mediaType];
        const buffer = await downloadMediaMessage(source, "buffer", {});
        let payload;

        switch (mediaType) {
          case "imageMessage":
            payload = { image: buffer, caption: media.caption || undefined, mimetype: media.mimetype || "image/jpeg" };
            break;
          case "videoMessage":
            payload = { video: buffer, caption: media.caption || undefined, mimetype: media.mimetype || "video/mp4" };
            break;
          case "audioMessage":
            payload = { audio: buffer, mimetype: media.mimetype || "audio/mpeg", ptt: !!media.ptt };
            break;
          case "documentMessage":
            payload = {
              document: buffer,
              mimetype: media.mimetype || "application/octet-stream",
              fileName: media.fileName || "saved-file"
            };
            break;
          case "stickerMessage":
            payload = { sticker: buffer };
            break;
        }

        await sock.sendMessage(sender, payload);
      }

      await sock.sendMessage(jid, { text: "Saved to your DM ✅" }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Save command failed:", error.message || error);
      await sock.sendMessage(jid, { text: "Couldn't save that message. Please try again." }, { quoted: message });
    }
  }
};
