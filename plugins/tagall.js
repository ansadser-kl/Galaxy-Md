"use strict";

module.exports = {
  name: "tagall",
  aliases: ["everyone"],
  description: "Mention all group members in a numbered list (admins only)",
  async execute({ sock, jid, message, query }) {
    if (!jid.endsWith("@g.us")) {
      return sock.sendMessage(jid, { text: "❌ Groups only." }, { quoted: message });
    }

    const metadata = await sock.groupMetadata(jid);
    const sender = message.key?.participant || message.key?.remoteJid;
    const admin = metadata.participants.find((p) => p.id === sender);
    if (admin?.admin !== "admin" && admin?.admin !== "superadmin") {
      return sock.sendMessage(jid, { text: "❌ Admins only." }, { quoted: message });
    }

    const mentions = metadata.participants.map((p) => p.id);
    const list = mentions
      .map((id, index) => `${index + 1}. @${id.split("@")[0].split(":")[0]}`)
      .join("\n");
    const text = `📢 *Attention Everyone!*\n${query ? `${query}\n\n` : ""}${list}`;

    await sock.sendMessage(jid, { text, mentions }, { quoted: message });
  },
};
