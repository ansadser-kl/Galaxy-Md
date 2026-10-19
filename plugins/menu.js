"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function readData() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "galaxy-data.json"), "utf8"));
  } catch {
    return {};
  }
}

function bytesToSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "N/A";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(1) + " " + units[i];
}

function commandName(plugin) {
  const names = [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])];
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
}

module.exports = {
  name: "menu",
  aliases: ["help", "commands"],
  description: "Shows the Galaxy-MD command menu with an image.",
  async execute({ sock, jid, message, config, plugins }) {
    const data = readData();
    const prefix = String(data.prefix || config.prefix || ".");
    const botName = String(data.botName || config.botName || "GALAXY-MD");
    const botOwner = String(data.ownerNumber || config.ownerNumber || "N/A");
    const mode = String(config.mode || "public").toUpperCase();
    const used = bytesToSize(os.totalmem() - os.freemem());
    const total = bytesToSize(os.totalmem());
    const version = String(config.version || "1.0.0");
    const sender = String(message.pushName || message.senderName || "User")
      .replace(/[\\r\n]+/g, "").slice(0, 60);

    // Commands hidden from the menu at the user's request.
    const hiddenCommands = new Set([
      "antiviewonce", "autoreply", "creator", "getmd", "delcmd",
      "everyone", "groupinfo", "resetsession", "setcmd", "s", "st",
      "viewonce", "wt"
    ]);
    const normalizeCommand = (name) => String(name || "")
      .toLowerCase()
      .replace(/[\\s_-]+/g, "");

    const groups = new Map();
    for (const plugin of plugins || []) {
      const category = String(plugin.category || plugin.use || "General");
      const names = commandName(plugin).filter(
        (name) => !hiddenCommands.has(normalizeCommand(name))
      );
      if (!names.length) continue;
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(...names);
    }

    let index = 0;
    let commandText = "";
    for (const [category, names] of groups) {
      const uniqueNames = [...new Set(names)].sort((a, b) => a.localeCompare(b));
      commandText += "\n\n╭─『 *" + category.toUpperCase() + "* 』\n";
      for (const name of uniqueNames) {
        index++;
        commandText += "│ " + " " + prefix + name + "\n";
      }
      commandText += "╰────────────────";
    }

    const caption = [
      "╭━━━〔  *" + botName + "* 〕━━━╮",
      "│",
      "│  ✧ *BOT DASHBOARD*",
      "│  ├─  User: " + sender,
      "│  ├─  Owner: " + botOwner,
      "│  ├─  Mode: " + mode,
      "│  ├─  Host: " + os.platform(),
      "│  ├─  RAM: " + used + " / " + total,
      "│  ├─  Version: " + version,
      "│  └─  Commands: " + index,
      "│",
      "╰━━〔 *COMMAND CENTER* 〕━━╯",
      commandText || "\nNo commands found.",
      "",
      "╭─〔  *GALAXY-MD* 〕",
      "│ ✦ Prefix: " + prefix,
      "│ ✦ Choose a command and enjoy!",
      "╰────────────────"
    ].join("\n");

    const imageUrl = "https://i.ibb.co/B5t1nd97/temp.jpg";
    try {
      await sock.sendMessage(jid, { image: { url: imageUrl }, caption }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Menu image send failed:", error.message || error);
      await sock.sendMessage(jid, { text: caption }, { quoted: message });
    }
  }
};
