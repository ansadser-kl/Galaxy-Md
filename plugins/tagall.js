"use strict";

const config = require("../config");

const digits = (s) => String(s || "").split("@")[0].split(":")[0].replace(/\D/g, "");

function getContext(message) {
  const m = message?.message || {};
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    null
  );
}

function quotedText(q) {
  return (
    q?.conversation ||
    q?.extendedTextMessage?.text ||
    q?.imageMessage?.caption ||
    q?.videoMessage?.caption ||
    q?.documentMessage?.caption ||
    ""
  ).trim();
}

const memberId = (p) => p?.id || p?.lid || "";
const memberNum = (p) => digits(memberId(p));

module.exports = {
  name: "tag",
  aliases: [],
  description: "Tag group members: .tag all | .tag admin | .tag <text> | reply + .tag",
  category: "Group",

  async execute({ sock, jid, message, text, args, config: runtimeConfig }) {
    const cfg = runtimeConfig || config;

    if (!jid.endsWith("@g.us")) {
      return sock.sendMessage(jid, { text: "❌ Groups only." }, { quoted: message });
    }

    // Owner / bot-il ninnulla command mathram (fromMe)
    const sender = digits(message?.key?.participant || message?.key?.participantAlt || "");
    const owner = digits(cfg.ownerNumber);
    if (!message?.key?.fromMe && !(owner && sender === owner)) {
      return sock.sendMessage(jid, { text: "❌ Owner only." }, { quoted: message });
    }

    try {
      const metadata = await sock.groupMetadata(jid);
      const participants = (metadata?.participants || []).filter(memberId);
      const mentions = participants.map(memberId);

      // ".tag all" / ".tag admin" / ".tag hello" -> command word maathram maattum
      const input = String(text || args?.join(" ") || "").trim()
        .replace(/^[.!/#]?tag\b\s*/i, "")
        .trim();
      const lower = input.toLowerCase();

      if (lower === "all") {
        const list = participants.map((p, i) => `${i + 1}. @${memberNum(p)}`).join("\n");
        return sock.sendMessage(jid, { text: list, mentions }, { quoted: message });
      }

      if (lower === "admin" || lower === "admins") {
        const admins = participants.filter((p) => p.admin || p.superadmin);
        const list = admins.map((p, i) => `${i + 1}. @${memberNum(p)}`).join("\n") || "Admins illa.";
        return sock.sendMessage(jid, {
          text: list,
          mentions: admins.map(memberId)
        }, { quoted: message });
      }

      if (input) {
        return sock.sendMessage(jid, { text: input, mentions }, { quoted: message });
      }

      // Reply cheytha message-ile content, ella members-ineyum tag cheyyum
      const ctx = getContext(message);
      const quoted = ctx?.quotedMessage;
      if (!quoted) {
        return sock.sendMessage(jid, {
          text: "_Example:_\n.tag all\n.tag admin\n.tag <text>\nOru message-ilekku reply cheythu .tag ayakkuka"
        }, { quoted: message });
      }

      const body = quotedText(quoted);
      if (body) {
        return sock.sendMessage(jid, { text: body, mentions }, { quoted: message });
      }

      // Media aanenkil forward cheyyum (mention illathe)
      await sock.sendMessage(jid, {
        forward: {
          key: { remoteJid: jid, fromMe: false, id: ctx.stanzaId, participant: ctx.participant },
          message: quoted
        }
      });
    } catch (error) {
      console.error("[GALAXY-MD] Tag failed:", error?.message || error);
      await sock.sendMessage(jid, { text: "❌ Tag failed. Please try again." }, { quoted: message });
    }
  }
};
