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
    const stars = ["✦", "✯", "✰", "◬", "✧"];
    const star = stars[Math.floor(Math.random() * stars.length)];
    const data = readData();
    const prefix = String(data.prefix || config.prefix || ".");
    const botName = String(data.botName || config.botName || "GALAXY-MD");
    const botOwner = String(data.ownerNumber || config.ownerNumber || "N/A");
    const mode = String(config.mode || "public").toUpperCase();
    const used = bytesToSize(os.totalmem() - os.freemem());
    const total = bytesToSize(os.totalmem());
    const version = String(config.version || "1.0.0");
    const sender = String(message.pushName || message.senderName || "User").replace(/[\r\n]+/g, "").slice(0, 60);

    const groups = new Map();
    for (const plugin of plugins || []) {
      const category = String(plugin.category || plugin.use || "General");
      for (const name of commandName(plugin)) {
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(name);
      }
    }

    let index = 0;
    let commandText = "";
    for (const [category, names] of groups) {
      commandText += "\n\n╭════〘 *_" + category.charAt(0).toUpperCase() + category.slice(1) + "_* 〙════⊷❍\n";
      for (const name of [...new Set(names)].sort((a, b) => a.localeCompare(b))) {
        index++;
        commandText += "┃" + star + "│ _\x60" + index + ".\x60 " + prefix + name + "_\n";
      }
      commandText += "┃" + star + "╰─────────────────❍\n╰══════════════════⊷❍";
    }

    const caption = [
      "╭═══〘 \x60" + botName + "\x60 〙═══⊷❍",
      "",
      "┃" + star + "╭──────────────",
      "┃" + star + "│ Owner : " + botOwner,
      "┃" + star + "│ User : " + sender,
      "┃" + star + "│ Mode : " + mode,
      "┃" + star + "│ Server : " + (os.platform() === "linux" ? "Linux" : os.platform()),
      "┃" + star + "│ RAM : " + used + " / " + total,
      "┃" + star + "│ Version : " + version,
      "┃" + star + "│ Commands : " + index,
      "┃" + star + "╰───────────────",
      "╰═════════════════⊷",
      commandText || "\nNo commands found."
    ].join("\n");

    const configuredImage = String(data.setimage || "").trim();
    const defaultImage = "https://raw.githubusercontent.com/ansadser-kl/Galaxy-Md/main/utils/images/default.png";
    const imageUrl = configuredImage || defaultImage;
    try {
      await sock.sendMessage(jid, { image: { url: imageUrl }, caption }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Menu image send failed:", error.message || error);
      await sock.sendMessage(jid, { text: caption }, { quoted: message });
    }
  }
};
