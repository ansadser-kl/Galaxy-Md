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

function extractRealViewOnce(rootMsg) {
  if (!rootMsg || typeof rootMsg !== "object") return null;

  let current = rootMsg;
  let hasViewOnceWrapper = false;

  // Unwrap all Baileys 7 / WhatsApp outer containers (without touching contextInfo.quotedMessage)
  for (let i = 0; i < 10; i++) {
    if (current.viewOnceMessage?.message) {
      hasViewOnceWrapper = true;
      current = current.viewOnceMessage.message;
    } else if (current.viewOnceMessageV2?.message) {
      hasViewOnceWrapper = true;
      current = current.viewOnceMessageV2.message;
    } else if (current.viewOnceMessageV2Extension?.message) {
      hasViewOnceWrapper = true;
      current = current.viewOnceMessageV2Extension.message;
    } else if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
    } else if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
    } else if (current.deviceSentMessage?.message) {
      current = current.deviceSentMessage.message;
    } else if (current.editedMessage?.message) {
      current = current.editedMessage.message;
    } else {
      break;
    }
  }

  for (const type of ["imageMessage", "videoMessage", "audioMessage"]) {
    const media = current?.[type];
    if (media && (hasViewOnceWrapper || media.viewOnce === true)) {
      return {
        type,
        media,
        cleanMessage: { [type]: media },
      };
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
      const patch = { autovv: enabled };
      if (enabled) {
        patch.autovvTarget = jid;
      }
      writeData(patch);
      return reply(
        enabled
          ? "✅ *Auto View Once ON*\nIni groups-ilum personal chats-ilum varunna ella View Once files-um direct ee chat-ilekk varum."
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

  async handleReply({ sock, jid, message }) {
    const data = readData();
    if (data.autovv !== true) return false;

    const key = message?.key || {};
    if (key.fromMe) return false;

    const vo = extractRealViewOnce(message?.message);
    if (!vo) return false;

    if (key.id) {
      if (seen.has(key.id)) return false;
      seen.add(key.id);
      if (seen.size > 300) seen.delete(seen.values().next().value);
    }

    const targetJid = data.autovvTarget;
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
