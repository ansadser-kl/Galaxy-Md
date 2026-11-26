"use strict";

const runtime = require("../lib/runtime");

module.exports = {
  name: "pair",
  aliases: ["clone", "unpair", "delsession", "sessions", "clones", "session"],
  category: "Owner",
  description: "Clone the bot to more WhatsApp numbers (owner / SUDO only)",
  async execute({ sock, jid, message, query, command, isPrivileged }) {
    const reply = (text, extra = {}) => sock.sendMessage(jid, { text, ...extra }, { quoted: message });
    if (!isPrivileged) return reply("⛔ Owner/SUDO only.");

    const limits = typeof runtime.getLimits === "function"
      ? runtime.getLimits()
      : { max: 4, used: 1 };

    if (["sessions", "clones", "session"].includes(command)) {
      const sessions = typeof runtime.listSessions === "function" ? runtime.listSessions() : [];
      const lines = sessions.map((item) =>
        (item.slot === 1 ? "🟢 MAIN" : "🔵 CLONE-" + item.slot) +
        " | " + (item.number || "unknown") + " | " + (item.status || "offline")
      );
      return reply(
        `🤖 *Active sessions* (${sessions.length}/${limits.max})\n` +
        (lines.join("\n") || "None") +
        "\n\n.pair <number> • .unpair <number|slot|all>"
      );
    }

    if (["unpair", "delsession"].includes(command)) {
      const target = String(query || "").trim();
      if (!target) return reply("Usage: .unpair <number|slot|all>");
      if (typeof runtime.stopClone !== "function") return reply("Session manager is not ready yet.");
      const result = await runtime.stopClone(target);
      if (!result?.removed?.length) return reply("No paired session matched that value.");
      return reply("✅ Unpaired and deleted:\n" + result.removed.map((item) =>
        `CLONE-${item.slot} | ${item.number || "unknown"}`
      ).join("\n"));
    }

    const number = String(query || "").replace(/\D/g, "");
    if (number.length < 8 || number.length > 15) {
      return reply("Usage: .pair <number with country code>\nExample: .pair 919876543210");
    }
    if (typeof runtime.startClone !== "function") return reply("Session manager is not ready yet.");

    const wait = await reply("⏳ Creating CLONE session and requesting a pairing code for " + number + " ...").catch(() => null);
    const result = await runtime.startClone(number);

    if (!result?.ok) return reply("❌ " + (result?.reason || "Could not create the session."));

    if (result.alreadyLinked) {
      return reply(`✅ CLONE-${result.slot} restored from its saved session and is connecting now.`);
    }

    const text = [
      `✅ *CLONE-${result.slot} created*`,
      "Number: " + result.number,
      `Slot: ${result.slot}/${limits.max}`,
      "",
      "*Pairing code:* " + result.code,
      "",
      "On the " + result.number + " phone:",
      "WhatsApp → Linked devices → Link with phone number → enter this code.",
      "",
      "The clone works only while its session is live. Logging out from WhatsApp deletes that session folder automatically.",
    ].join("\n");

    if (wait?.key) {
      try {
        await sock.sendMessage(jid, { text, edit: wait.key }, { quoted: message });
        return;
      } catch {}
    }
    return reply(text);
  },
};
