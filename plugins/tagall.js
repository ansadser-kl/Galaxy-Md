"use strict";

module.exports = {
  name: "tagall",
  aliases: [],
  description: "Mention all group members in a numbered list (admins only)",
  async execute({ sock, jid, message, query }) {
    if (!jid.endsWith("@g.us")) {
      return sock.sendMessage(jid, { text: "❌ Groups only." }, { quoted: message });
    }

    try {
      const metadata = await sock.groupMetadata(jid);
      const sameJid = (a, b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        return String(a).split("@")[0].split(":")[0] === String(b).split("@")[0].split(":")[0];
      };
      const sender = message.key?.participant || message.key?.participantAlt || message.key?.remoteJid;
      const admin = metadata.participants.find((p) =>
        sameJid(p.id, sender) || sameJid(p.lid, sender)
      );
      if (!admin?.admin && !admin?.superadmin && !message.key?.fromMe) {
        return sock.sendMessage(jid, { text: "❌ Admins only." }, { quoted: message });
      }

      const participants = metadata.participants.filter((p) => p.id);
      const mentions = participants.map((p) => p.id);
      const list = participants
        .map((p, index) => `${index + 1}. @${p.id.split("@")[0].split(":")[0]}`)
        .join("\n");
      const text = `📢 *Attention Everyone!*\n${query ? `${query}\n\n` : ""}${list}`;

      await sock.sendMessage(jid, { text, mentions }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Tagall failed:", error.message || error);
      await sock.sendMessage(jid, { text: "❌ Tagall failed. Please try again." }, { quoted: message });
    }
  }
};
