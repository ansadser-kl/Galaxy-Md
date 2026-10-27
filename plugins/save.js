"use strict";

const pino = require("pino");

function unwrapMessage(message) {
  let current = message || {};
  while (
    current.ephemeralMessage?.message ||
    current.viewOnceMessage?.message ||
    current.viewOnceMessageV2?.message ||
    current.documentWithCaptionMessage?.message
  ) {
    current =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.documentWithCaptionMessage?.message;
  }
  return current;
}

function getQuoted(message) {
  const msg = unwrapMessage(message?.message);
  const context =
    msg?.extendedTextMessage?.contextInfo ||
    msg?.imageMessage?.contextInfo ||
    msg?.videoMessage?.contextInfo ||
    msg?.documentMessage?.contextInfo ||
    msg?.audioMessage?.contextInfo ||
    msg?.stickerMessage?.contextInfo;

  if (!context?.quotedMessage || !context?.stanzaId) return null;
  return { context, message: unwrapMessage(context.quotedMessage) };
}

function getSenderJid(message) {
  const jid = message?.key?.remoteJid || "";
  if (jid.endsWith("@g.us")) {
    return message.key.participant || message.key.participantAlt || "";
  }
  return jid && jid !== "status@broadcast" ? jid : "";
}

module.exports = {
  name: "save",
  aliases: [],
  description: "Send a replied message to the command user's private chat",
  category: "Utility",

  async execute({ sock, jid, message }) {
    const quotedInfo = getQuoted(message);
    if (!quotedInfo) {
      await sock.sendMessage(
        jid,
        { text: "Reply to any message with .save and I'll send it to your DM." },
        { quoted: message }
      );
      return;
    }

    const sender = getSenderJid(message);
    if (!sender || sender === "status@broadcast" || sender.endsWith("@g.us")) {
      await sock.sendMessage(
        jid,
        { text: "Couldn't identify your private chat. Try again." },
        { quoted: message }
      );
      return;
    }

    const { context } = quotedInfo;
    const quoted = quotedInfo.message;
    const source = {
      key: {
        remoteJid: jid,
        id: context.stanzaId,
        participant: context.participant || undefined,
        fromMe: false,
      },
      message: context.quotedMessage,
    };

    try {
      const text =
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption;

      if (text && !quoted.imageMessage && !quoted.videoMessage && !quoted.documentMessage) {
        await sock.sendMessage(sender, { text });
      } else {
        const mediaType = [
          "imageMessage",
          "videoMessage",
          "audioMessage",
          "documentMessage",
          "stickerMessage",
        ].find((type) => quoted[type]);

        if (!mediaType) {
          await sock.sendMessage(
            jid,
            { text: "This message type isn't supported by .save yet." },
            { quoted: message }
          );
          return;
        }

        const baileys = await import("baileys");
        if (typeof baileys.downloadMediaMessage !== "function") {
          throw new Error("Baileys downloadMediaMessage export is unavailable");
        }

        const buffer = await baileys.downloadMediaMessage(source, "buffer", {}, {
          logger: pino({ level: "silent" }),
          reuploadRequest: sock.updateMediaMessage,
        });

        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
          throw new Error("Downloaded media is empty");
        }

        const media = quoted[mediaType];
        let payload;

        switch (mediaType) {
          case "imageMessage":
            payload = {
              image: buffer,
              caption: media.caption || undefined,
              mimetype: media.mimetype || "image/jpeg",
            };
            break;
          case "videoMessage":
            payload = {
              video: buffer,
              caption: media.caption || undefined,
              mimetype: media.mimetype || "video/mp4",
            };
            break;
          case "audioMessage":
            payload = {
              audio: buffer,
              mimetype: media.mimetype || "audio/ogg; codecs=opus",
              ptt: !!media.ptt,
            };
            break;
          case "documentMessage":
            payload = {
              document: buffer,
              mimetype: media.mimetype || "application/octet-stream",
              fileName: media.fileName || "saved-file",
              caption: media.caption || undefined,
            };
            break;
          case "stickerMessage":
            payload = { sticker: buffer };
            break;
        }

        await sock.sendMessage(sender, payload);
      }

      await sock.sendMessage(
        jid,
        { text: "✅ Saved! Check your private message (DM)." },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] Save command failed:", error?.stack || error);
      await sock.sendMessage(
        jid,
        {
          text: "❌ Couldn't send this message to your DM. Make sure you've opened a private chat with the bot, then try .save again.",
        },
        { quoted: message }
      ).catch(() => {});
    }
  },
};
