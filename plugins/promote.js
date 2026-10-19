"use strict";

module.exports = {
  name: "promote",
  aliases: [],
  description: "Promote a member to admin (admins only)",
  async execute({ sock, jid, message }) {
    if (!jid.endsWith("@g.us")) return sock.sendMessage(jid, { text: "❌ Groups only." }, { quoted: message });
    const metadata = await sock.groupMetadata(jid);
    const sender = message.key?.participant || message.key?.remoteJid;
    const senderInfo = metadata.participants.find((p) => p.id === sender);
    const botNumber = sock.user?.id?.split(":")[0];
    const botInfo = metadata.participants.find((p) => p.id === sock.user?.id || p.id?.startsWith(botNumber + ":"));
    if (senderInfo?.admin !== "admin" && senderInfo?.admin !== "superadmin") return sock.sendMessage(jid, { text: "❌ Admins only." }, { quoted: message });
    if (botInfo?.admin !== "admin" && botInfo?.admin !== "superadmin") return sock.sendMessage(jid, { text: "❌ Make the bot a group admin first." }, { quoted: message });
    const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!target) return sock.sendMessage(jid, { text: "Usage: .promote @member" }, { quoted: message });
    const member = metadata.participants.find((p) => p.id === target || p.id?.startsWith(target.split("@")[0] + ":"));
    if (!member) return sock.sendMessage(jid, { text: "❌ Member not found." }, { quoted: message });
    if (member.admin) return sock.sendMessage(jid, { text: "ℹ️ That member is already an admin." }, { quoted: message });
    await sock.groupParticipantsUpdate(jid, [member.id], "promote");
    await sock.sendMessage(jid, { text: "✅ Member promoted to admin." }, { quoted: message });
  },
};
