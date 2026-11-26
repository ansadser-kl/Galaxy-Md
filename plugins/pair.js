"use strict";

// .pair <number>        link another WhatsApp number as a bot (clone)
// .pair list            show linked clones          (owner / SUDO)
// .pair remove <number> unlink a clone              (owner / SUDO)
//
// PAIR_OWNER_ONLY=true  lets only the owner / SUDO use .pair <number>
// MAX_CLONES=4          how many numbers can be linked at once (0 turns the feature off)

const OWNER_ONLY = String(process.env.PAIR_OWNER_ONLY || "").toLowerCase() === "true";

function formatCode(code) {
  const clean = String(code || "").replace(/[^A-Za-z0-9]/g, "");
  return clean.length === 8 ? clean.slice(0, 4) + "-" + clean.slice(4) : String(code);
}

module.exports = {
  name: "pair",
  aliases: ["clone"],
  description: "Link another WhatsApp number as a bot (clone)",
  category: "Utility",

  async execute({ sock, jid, message, args, config, isPrivileged, manager }) {
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    const prefix = config.prefix || ".";

    if (config.isClone) return reply("⛔ A clone bot cannot link other numbers.");
    if (!manager) return reply("❌ The clone system is not available.");

    const sub = String(args?.[0] || "").toLowerCase();

    if (sub === "list") {
      if (!isPrivileged) return reply("⛔ Owner/SUDO only.");
      const items = manager.list();
      if (!items.length) return reply(`👥 No clones linked (0/${manager.max}).`);
      return reply(
        `👥 *Clone bots* (${items.length}/${manager.max})\n\n` +
        items.map((item) => `${item.slot - 1}. ${item.number} ${item.live ? "🟢 live" : "🟡 connecting"}`).join("\n") +
        `\n\nRemove one: ${prefix}pair remove <number>`
      );
    }

    if (sub === "remove" || sub === "delete") {
      if (!isPrivileged) return reply("⛔ Owner/SUDO only.");
      const removed = await manager.remove(args.slice(1).join(""));
      return reply(removed ? "✅ Clone removed and its session deleted." : "❌ No clone found with that number.");
    }

    if (OWNER_ONLY && !isPrivileged) return reply("⛔ Only the owner can link numbers.");

    const digits = String(args.join("")).replace(/\D/g, "");
    if (!digits) {
      return reply(
        "*Pair a number*\n\n" +
        `Usage: ${prefix}pair 919876543210\n` +
        "(country code + number, no +)\n\n" +
        `Slots used: ${manager.count()}/${manager.max}`
      );
    }

    const requester = String(message.key?.participant || message.key?.participantAlt || message.key?.remoteJid || jid);

    try {
      await reply("⏳ Creating pairing code...");
      const result = await manager.pair(digits, {
        requester,
        bypassCooldown: isPrivileged,
        onConnected: () =>
          sock.sendMessage(jid, { text: `✅ *${digits}* is connected. The bot now runs on that number too.\nSend ${prefix}menu from it.` }, { quoted: message }),
      });
      return reply(
        "🔗 *PAIRING CODE*\n\n" +
        "`" + formatCode(result.code) + "`\n\n" +
        "📲 WhatsApp → Linked devices → Link with phone number → enter this code.\n" +
        `⏳ Enter it within ${Math.round(result.waitSeconds / 60)} minutes.\n` +
        `👥 Slots: ${result.used}/${result.max}\n\n` +
        "If you log out from the phone, this bot is removed automatically."
      );
    } catch (error) {
      if (!error.user) console.error("[GALAXY-MD] .pair error:", error.message || error);
      return reply("❌ " + (error.user ? error.message : "Could not create a pairing code. Try again later."));
    }
  },
};
