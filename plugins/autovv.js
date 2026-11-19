"use strict";

const fs = require("fs");
const path = require("path");
const { downloadMediaMessage } = require("baileys");

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

function unwrapViewOnce(msgContent) {
  if (!msgContent || typeof msgContent !== "object") return null;

  let current = msgContent;
  while (
    current.ephemeralMessage?.message ||
    current.viewOnceMessage?.message ||
    current.viewOnceMessageV2?.message ||
    current.viewOnceMessageV2Extension?.message ||
    current.documentWithCaptionMessage?.message
  ) {
    current =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
  }

  // Check if original message was wrapped as viewOnce OR has viewOnce flag
  const wasWrapped = Boolean(
    msgContent.viewOnceMessage ||
    msgContent.viewOnceMessageV2 ||
    msgContent.viewOnceMessageV2Extension ||
    msgContent.ephemeralMessage?.message?.viewOnceMessage ||
    msgContent.ephemeralMessage?.message?.viewOnceMessageV2 ||
    msgContent.ephemeralMessage?.message?.viewOnceMessageV2Extension
  );

  for (const type of ["imageMessage", "videoMessage", "audioMessage"]) {
    const media = current[type];
    if (media && (wasWrapped || media.viewOnce)) {
      return { type, media, cleanMessage: { [type]: media } };
    }
  }

  return null;
}

function getTargetJid(data, sock, config) {
  if (data.autovvTarget) return data.autovvTarget;
  if (sock?.user?.lid) return sock.user.lid;
  const rawId = sock?.user?.id || "";
  if (rawId) {
    const num = rawId.split(":")[0].split("@")[0].replace(/\D/g, "");
    if (num) return `${num}@s.whatsapp.net`;
  }
  const ownerNum = String(config?.ownerNumber || config?.botNumber || "").replace(/\D/g, "");
  return ownerNum ? `${ownerNum}@s.whatsapp.net` : "";
}

module.exports = {
  name: "autovv",
  aliases: ["avv"],
  description: "Auto save View Once media to your own chat (.autovv on / off / status)",
  category: "Owner",

  async execute({ sock, jid, message, args, isPrivileged, config }) {
    const arg = String(args?.[0] || "").toLowerCase().trim();
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    if (arg === "on" || arg === "off") {
      if (!isPrivileged) return reply("❌ Owner mathram use cheyyam.");
      const enabled = arg === "on";
      const patch = { autovv: enabled };
      // Save the chat JID where .autovv on was triggered (if DM/self-chat), else fallback to own JID
      if (enabled) {
        patch.autovvTarget = !jid.endsWith("@g.us")
          ? jid
          : getTargetJid(readData(), sock, config);
      }
      writeData(patch);
      return reply(
        enabled
          ? "✅ *Auto View Once ON*\nIni groups-ilum personal chats-ilum varunna ella View Once files-um ee chat-ilekk varum."
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
    const data = readData();
    if (data.autovv !== true) return false;

    const key = message?.key || {};
    if (key.fromMe) return false;

    const vo = unwrapViewOnce(message?.message);
    if (!vo) return false;

    if (key.id) {
      if (seen.has(key.id)) return false;
      seen.add(key.id);
      if (seen.size > 300) seen.delete(seen.values().next().value);
    }

    const targetJid = getTargetJid(data, sock, config);
    if (!targetJid) return false;

    try {
      const source = {
        key: message.key,
        message: vo.cleanMessage,
      };

      const buffer = await downloadMediaMessage(source, "buffer", {});
      if (!buffer || !buffer.length) return false;

      const isGroup = jid.endsWith("@g.us");
      const senderJid = isGroup ? (key.participant || key.participantAlt || "") : jid;
      const senderNum = senderJid ? senderJid.split("@")[0].split(":")[0] : "Unknown";
      const pushName = String(message?.pushName || "").replace(/[\r\n]+/g, " ").trim();

      let chatLabel = `💬 *Chat:* @${senderNum}${pushName ? ` (${pushName})` : ""}`;
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
        await sock.sendMessage(targetJid, {
          image: buffer,
          caption: infoCaption,
          mentions,
        });
      } else if (vo.type === "videoMessage") {
        await sock.sendMessage(targetJid, {
          video: buffer,
          mimetype: vo.media?.mimetype || "video/mp4",
          caption: infoCaption,
          mentions,
        });
      } else if (vo.type === "audioMessage") {
        await sock.sendMessage(targetJid, {
          audio: buffer,
          mimetype: vo.media?.mimetype || "audio/ogg; codecs=opus",
          ptt: Boolean(vo.media?.ptt),
        });
        await sock.sendMessage(targetJid, { text: infoCaption, mentions });
      }
    } catch (error) {
      console.error("[GALAXY-MD] autovv failed:", error?.message || error);
    }

    return false;
  },
};
