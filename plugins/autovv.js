"use strict";

const fs = require("fs");
const path = require("path");
const { downloadMediaMessage, getContentType } = require("@whiskeysockets/baileys");

const DATA_FILE = path.join(__dirname, "..", "galaxy-data.json");
const seen = new Set();

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeData(patch) {
  const data = { ...readData(), ...patch };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getOwnJid(sock, config) {
  const rawId = sock?.user?.id || "";
  if (rawId) {
    const num = rawId.split(":")[0].split("@")[0].replace(/\D/g, "");
    if (num) return `${num}@s.whatsapp.net`;
  }
  const ownerNum = String(config?.ownerNumber || "").replace(/\D/g, "");
  return ownerNum ? `${ownerNum}@s.whatsapp.net` : "";
}

function extractViewOnce(msgContent) {
  if (!msgContent || typeof msgContent !== "object") return null;

  // Unwrap ephemeral / viewOnce wrappers
  let inner = msgContent;
  if (inner.ephemeralMessage?.message) inner = inner.ephemeralMessage.message;

  const voWrapper =
    inner.viewOnceMessage?.message ||
    inner.viewOnceMessageV2?.message ||
    inner.viewOnceMessageV2Extension?.message;

  if (voWrapper) {
    const type = getContentType(voWrapper);
    if (type && voWrapper[type]) {
      return { type, media: voWrapper[type], container: voWrapper };
    }
  }

  // Direct media with viewOnce: true flag (newer WhatsApp builds)
  for (const type of ["imageMessage", "videoMessage", "audioMessage"]) {
    if (inner[type]?.viewOnce) {
      return { type, media: inner[type], container: inner };
    }
  }

  return null;
}

module.exports = {
  name: "autovv",
  aliases: ["avv"],
  description: "Auto save View Once media to your own chat (.autovv on / off / status)",
  category: "Owner",

  async execute({ sock, jid, message, args, isPrivileged }) {
    const arg = String(args?.[0] || "").toLowerCase().trim();
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    if (arg === "on" || arg === "off") {
      if (!isPrivileged) return reply("❌ Owner mathram use cheyyam.");
      const enabled = arg === "on";
      writeData({ autovv: enabled });
      return reply(
        enabled
          ? "✅ *Auto View Once ON*\nIni groups-ilum personal chats-ilum varunna ella View Once files-um swantham chat-ilekk varum."
          : "⛔ *Auto View Once OFF*"
      );
    }

    const isOn = readData().autovv === true;
    return reply(
      `👁️ *Auto View Once Status:* ${isOn ? "ON ✅" : "OFF ⛔"}\n\n` +
      `• *.autovv on* — Full chats & groups-il ON aakkan\n` +
      `• *.autovv off* — Full chats & groups-il OFF aakkan\n` +
      `• *.autovv status* — Current status ariyan`
    );
  },

  async handleReply({ sock, jid, message, config }) {
    if (readData().autovv !== true) return false;

    const key = message?.key || {};
    if (key.fromMe) return false;

    const vo = extractViewOnce(message?.message);
    if (!vo) return false;

    // Prevent duplicate processing
    if (key.id) {
      if (seen.has(key.id)) return false;
      seen.add(key.id);
      if (seen.size > 300) seen.delete(seen.values().next().value);
    }

    const selfJid = getOwnJid(sock, config);
    if (!selfJid) return false;

    try {
      const fakeMsg = {
        key: message.key,
        message: vo.container,
      };

      const buffer = await downloadMediaMessage(
        fakeMsg,
        "buffer",
        {},
        {
          logger: console,
          reuploadRequest: sock.updateMediaMessage,
        }
      );

      if (!buffer || !buffer.length) return false;

      const isGroup = jid.endsWith("@g.us");
      const senderJid = isGroup ? (key.participant || key.participantAlt || "") : jid;
      const senderNum = senderJid ? senderJid.split("@")[0].split(":")[0] : "Unknown";
      const pushName = String(message?.pushName || "").replace(/[\r\n]+/g, " ").trim();

      let chatLabel = `💬 *Chat:* @${senderNum}`;
      if (isGroup) {
        let groupName = jid;
        try {
          const meta = await sock.groupMetadata(jid);
          if (meta?.subject) groupName = meta.subject;
        } catch {}
        chatLabel = `👥 *Group:* ${groupName}\n👤 *Sender:* @${senderNum}${pushName ? ` (${pushName})` : ""}`;
      }

      const originalCaption = String(vo.media?.caption || "").trim();
      const infoCaption = [
        `👁️ *Auto View Once Captured*`,
        chatLabel,
        originalCaption ? `📝 *Caption:* ${originalCaption}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const mentions = senderJid && senderJid.includes("@") ? [senderJid] : [];

      if (vo.type === "imageMessage") {
        await sock.sendMessage(selfJid, {
          image: buffer,
          caption: infoCaption,
          mentions,
        });
      } else if (vo.type === "videoMessage") {
        await sock.sendMessage(selfJid, {
          video: buffer,
          mimetype: vo.media?.mimetype || "video/mp4",
          caption: infoCaption,
          mentions,
        });
      } else if (vo.type === "audioMessage") {
        await sock.sendMessage(selfJid, {
          audio: buffer,
          mimetype: vo.media?.mimetype || "audio/ogg; codecs=opus",
          ptt: Boolean(vo.media?.ptt),
        });
        await sock.sendMessage(selfJid, { text: infoCaption, mentions });
      }
    } catch (error) {
      console.error("[GALAXY-MD] autovv failed:", error?.message || error);
    }

    // Return false so other listeners (if any) are not blocked
    return false;
  },
};
