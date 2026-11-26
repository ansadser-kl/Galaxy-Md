"use strict";

const { engine } = require("../lib/yt");

module.exports = {
  name: "ytlogin",
  aliases: ["ytlogout"],
  description: "Sign in to YouTube (owner only), for servers YouTube asks to confirm they are not a bot",
  category: "Owner",

  async execute({ sock, jid, message, args, command, isPrivileged }) {
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    if (!isPrivileged) return reply("⛔ Owner/SUDO only.");

    if (command === "ytlogout") {
      await engine.logout();
      return reply("✅ Signed out of YouTube.");
    }

    const arg = String(args?.[0] || "").toLowerCase();
    const loggedIn = await engine.isLoggedIn();
    if (arg === "status") return reply(loggedIn ? "✅ Signed in to YouTube." : "ℹ️ Not signed in to YouTube.");
    if (loggedIn && arg !== "force") {
      return reply("Already signed in.\n.ytlogout to sign out, .ytlogin force to sign in again.");
    }

    // return once the code is sent: waiting for approval would hold up message handling
    await new Promise((codeSent) => {
      engine
        .login(async ({ verification_url, user_code, expires_in }) => {
          await reply(
            "*YouTube login*\n\n" +
            "1. Open " + verification_url + "\n" +
            "2. Enter *" + user_code + "*\n" +
            "3. Choose an account and allow access\n\n" +
            "Use a spare account. The code expires in " + Math.round(expires_in / 60) + " minutes."
          ).catch(() => {});
          codeSent();
        })
        .then(() => reply("✅ Signed in to YouTube."))
        .catch((error) => reply("❌ YouTube login failed: " + error.message))
        .catch(() => {})
        .finally(codeSent);
    });
  },
};
