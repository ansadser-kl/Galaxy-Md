"use strict";
module.exports = {
  name: "kick",
  aliases: ["remove"],
  description: "Remove a group member by replying or mentioning them (admins only)",
  category: "Group",
  async execute({ sock, jid, message }) {
    if (!jid.endsWith("@g.us")) return sock.sendMessage(jid, { text: "This command works in groups only." }, { quoted: message });
    const context = message.message?.extendedTextMessage?.contextInfo;
    const target = context?.mentionedJid?.[0] || context?.participant || context?.participantAlt;
    if (!target) return sock.sendMessage(jid, { text: "Mention a member or reply to their message with .kick" }, { quoted: message });
    const metadata = await sock.groupMetadata(jid);
    const sender = message.key.participant || message.key.participantAlt;
    const senderAdmin = metadata.participants.find(p => p.id === sender || p.lid === sender);
    const botJid = (sock.user?.id || "").split(":")[0].split("@")[0] + "@s.whatsapp.net";
    const botAdmin = metadata.participants.find(p => p.id === botJid);
    if (!senderAdmin?.admin && !senderAdmin?.superadmin && !message.key.fromMe) return sock.sendMessage(jid, { text: "Only group admins can use .kick." }, { quoted: message });
    if (!botAdmin?.admin && !botAdmin?.superadmin) return sock.sendMessage(jid, { text: "Make the bot a group admin first." }, { quoted: message });
    await sock.groupParticipantsUpdate(jid, [target], "remove");
  }
};
