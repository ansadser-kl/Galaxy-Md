"use strict";

const fs = require("fs");
const path = require("path");

function readData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "galaxy-data.json"), "utf8"));
  } catch {
    return {};
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return String(pkg.version || "3.7.0");
  } catch {
    return "3.7.0";
  }
}

function commandNames(plugin) {
  const names = [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])];
  return [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
}

module.exports = {
  name: "menu",
  aliases: ["help", "commands"],
  description: "Displays the bot menu with commands categorized by type.",

  async execute({ sock, jid, message, config: runtimeConfig, plugins }) {
    const cfg = runtimeConfig || require("../config") || {};
    const data = readData();

    const prefix = String(data.prefix || cfg.prefix || cfg.PREFIX || ".");
    const botName = String(data.botName || cfg.botName || cfg.BOT_NAME || "GALAXY-MD");
    const ownerName = String(data.ownerName || cfg.ownerName || cfg.OWNER_NAME || cfg.ownerNumber || "ANSAD SER");
    const mode = String(cfg.mode || "public").toUpperCase();
    const version = String(cfg.version || cfg.VERSION || readVersion());
    const readMore = String.fromCharCode(8206).repeat(4001);

    // Commands hidden from the menu
    const hiddenCommands = new Set([
      "antiviewonce", "autoreply", "creator", "getmd", "delcmd",
      "everyone", "groupinfo", "resetsession", "setcmd", "s", "st",
      "viewonce", "wt"
    ]);
    const normalizeCommand = (name) =>
      String(name || "")
        .toLowerCase()
        .replace(/[\s_-]+/g, "");

    const cmnd = [];
    const categorySet = new Set();

    for (const plugin of plugins || []) {
      if (plugin.dontAddCommandList) continue;
      const type = String(plugin.category || plugin.type || plugin.use || "misc")
        .trim()
        .toLowerCase() || "misc";

      const visibleNames = commandNames(plugin).filter(
        (name) => !hiddenCommands.has(normalizeCommand(name))
      );

      for (const cmd of visibleNames) {
        cmnd.push({ cmd, type });
        categorySet.add(type);
      }
    }

    cmnd.sort((a, b) => a.cmd.localeCompare(b.cmd));
    const categories = [...categorySet].sort((a, b) => a.localeCompare(b));

    let menu = `\n╭━━━〔 ${botName} 〕━━━┈
  ╭──────────────
  ❖ │  *OWNER*: ${ownerName}
  ❖ │  *COMMANDS*: ${cmnd.length}
  ❖ │  *MODE*: ${mode}
  ❖ │  *PREFIX*: ${prefix}
  ❖ │  *VERSION*: ${version}
  ╰──────────────
  ╰━━━━━━━━━━━━━━━┈\n ${readMore}`;

    for (const cmmd of categories) {
      menu += `\n ╭─────────────────────┈⚆`;
      menu += `\n  │ 「 *${cmmd.toUpperCase()}* 」`;
      menu += `\n ╰┬────────────────────┈⚆`;
      menu += `\n ╭┴────────────────────┈⚆`;

      const comad = cmnd.filter((item) => item.type === cmmd);
      for (const item of comad) {
        menu += `\n❆  ${prefix}${item.cmd.trim()}`;
      }

      menu += `\n ╰─────────────────────┈⚆`;
    }

    menu += `\n\n${botName}`;

    const mediaUrl = String(
      process.env.MENU_URL || cfg.MENU_URL || cfg.menuUrl || "https://galaxy-md-w3vr.onrender.com/dl/aseycE24EVyt"
    ).trim();

    try {
      const res = await fetch(mediaUrl, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,video/*,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error("Media HTTP " + res.status);

      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) throw new Error("Empty media buffer");

      if (contentType.startsWith("video/")) {
        await sock.sendMessage(
          jid,
          { video: buffer, gifPlayback: true, caption: menu },
          { quoted: message }
        );
      } else {
        await sock.sendMessage(
          jid,
          { image: buffer, caption: menu },
          { quoted: message }
        );
      }
    } catch (error) {
      console.error("[GALAXY-MD] Menu media send failed:", error?.message || error);
      await sock.sendMessage(jid, { text: menu }, { quoted: message });
    }
  }
};
