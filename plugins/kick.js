"use strict";

module.exports = {
  name: "kick",
  aliases: ["remove"],
  description: "Remove a group member by replying or mentioning them (admins only)",
  category: "Group",
  async execute({ sock, jid, message }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    if (!jid.endsWith("@g.us")) return send("This command works in groups only.");

    const context = message.message?.extendedTextMessage?.contextInfo;
    const target = context?.mentionedJid?.[0] || context?.participant || context?.participantAlt;
    if (!target) return send("Mention a member or reply to their message with .kick");

    try {
      const metadata = await sock.groupMetadata(jid);
      const sameJid = (a, b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        const normalize = (value) => String(value).split("@")[0].split(":")[0];
        return normalize(a) === normalize(b);
      };
      const sender = message.key?.participant || message.key?.participantAlt || message.key?.remoteJid;
      const senderInfo = metadata.participants.find((p) =>
        sameJid(p.id, sender) || sameJid(p.lid, sender)
      );
      const botInfo = metadata.participants.find((p) =>
        sameJid(p.id, sock.user?.id) ||
        sameJid(p.lid, sock.user?.lid) ||
        sameJid(p.id, (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net")
      );

      if (!senderInfo?.admin && !senderInfo?.superadmin && !message.key?.fromMe) {
        return send("Only group admins can use .kick.");
      }
      if (!botInfo?.admin && !botInfo?.superadmin) {
        return send("Make the bot a group admin first.");
      }

      const member = metadata.participants.find((p) =>
        sameJid(p.id, target) || sameJid(p.lid, target)
      );
      if (!member) return send("Member not found in this group.");
      if (member.superadmin) return send("The group owner cannot be removed.");

      await sock.groupParticipantsUpdate(jid, [member.id], "remove");
      return send("Member removed successfully.");
    } catch (error) {
      console.error("[GALAXY-MD] Kick failed:", error.message || error);
      return send("Kick failed. Check the bot's group-admin permission and try again.");
    }
  }
};
