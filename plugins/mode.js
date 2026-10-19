"use strict";

const fs = require("fs");
const path = require("path");

module.exports = {
  name: "mode",
  aliases: [],
  description: "Switch bot access between public and private",
  async execute({ sock, jid, message, query, config, isPrivileged, setMode }) {
    if (!isPrivileged) {
      await sock.sendMessage(jid, { text: "⛔ Only the bot number or a SUDO number can change bot mode." }, { quoted: message });
      return;
    }

    const requestedMode = String(query || "").trim().toLowerCase();
    if (!["public", "private"].includes(requestedMode)) {
      await sock.sendMessage(
        jid,
        { text: `⚙️ Current mode: *${config.mode.toUpperCase()}*\n\nUse:\n.mode public\n.mode private` },
        { quoted: message }
      );
      return;
    }

    try {
      fs.writeFileSync(
        path.join(__dirname, "..", "mode.json"),
        JSON.stringify({ mode: requestedMode }, null, 2) + "\n",
        "utf8"
      );
    } catch (error) {
      console.error("[GALAXY-MD] Could not save mode:", error.message || error);
      await sock.sendMessage(jid, { text: "⚠️ Could not save mode. Check file permissions." }, { quoted: message });
      return;
    }

    if (typeof setMode === "function") setMode(requestedMode);
    await sock.sendMessage(
      jid,
      { text: requestedMode === "public"
        ? "🌍 *PUBLIC MODE enabled.* Everyone can use bot commands."
        : "🔒 *PRIVATE MODE enabled.* Only the bot number and configured SUDO numbers can use commands." },
      { quoted: message }
    );
  },
};
