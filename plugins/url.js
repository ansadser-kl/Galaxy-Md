"use strict";

const { Buffer } = require("buffer");

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

function getQuotedMessage(message, jid) {
  const msg = unwrapMessage(message?.message);
  const contextInfo =
    msg?.extendedTextMessage?.contextInfo ||
    msg?.imageMessage?.contextInfo ||
    msg?.videoMessage?.contextInfo ||
    msg?.documentMessage?.contextInfo ||
    msg?.audioMessage?.contextInfo ||
    msg?.stickerMessage?.contextInfo;

  if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) return null;

  return {
    key: {
      remoteJid: jid,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant || undefined,
      fromMe: false,
    },
    message: contextInfo.quotedMessage,
  };
}

function getMediaType(message) {
  const msg = unwrapMessage(message?.message);
  const supported = [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
  ];
  const type = supported.find((key) => msg?.[key]);
  return type ? { type, media: msg[type] } : null;
}

module.exports = {
  name: "url",
  aliases: ["tourl", "upload"],
  description: "Upload replied media and return a public URL",

  async execute({ sock, jid, message, args = [] }) {
    try {
      const quoted = getQuotedMessage(message, jid);
      if (!quoted) {
        await sock.sendMessage(
          jid,
          { text: "Reply to an image, video, audio, sticker, or document with .url" },
          { quoted: message }
        );
        return;
      }

      const found = getMediaType(quoted);
      if (!found) {
        await sock.sendMessage(
          jid,
          { text: "Unsupported file. Reply to an image, video, audio, sticker, or document." },
          { quoted: message }
        );
        return;
      }

      await sock.sendMessage(jid, { text: "⏳ Uploading your file..." }, { quoted: message });

      const baileys = await import("baileys");
      const downloadMediaMessage = baileys.downloadMediaMessage;
      if (typeof downloadMediaMessage !== "function") {
        throw new Error("Baileys media download is unavailable");
      }

      const buffer = await downloadMediaMessage(quoted, "buffer", {}, {
        logger: require("pino")({ level: "silent" }),
        reuploadRequest: sock.updateMediaMessage,
      });

      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error("Downloaded media is empty");
      }

      const media = found.media;
      const mimetype = media.mimetype || "application/octet-stream";
      const filename =
        String(media.fileName || args.join(" ").trim() || `galaxy-upload-${Date.now()}`)
          .replace(/[\\r\\n"]/g, "_")
          .slice(0, 180);

      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mimetype }), filename);

      const response = await fetch("https://galaxy.anuansad50.workers.dev/upload", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120000),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Upload API returned an invalid response");
      }

      if (!response.ok || data?.success !== true || typeof data.url !== "string") {
        throw new Error(data?.error || `Upload failed (HTTP ${response.status})`);
      }

      await sock.sendMessage(
        jid,
        {
          text: `✅ *File uploaded successfully!*

🔗 ${data.url}`,
          detectLinks: true,
        },
        { quoted: message }
      );
    } catch (error) {
      console.error("[URL Plugin] Upload failed:", error?.stack || error);
      await sock.sendMessage(
        jid,
        { text: "❌ Upload failed. Please try again or use a smaller file." },
        { quoted: message }
      ).catch(() => {});
    }
  },
};
