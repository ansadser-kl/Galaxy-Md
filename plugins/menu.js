"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../config");

const CATEGORY_ORDER = ["General", "Utility", "Group", "Media", "Owner", "Other"];
let cachedCaption = "";
let cachedPluginNames = "";
let cachedImage = null;
let imageChecked = false;

function getCategory(plugin) {
  if (plugin.category) return String(plugin.category);
  const name = String(plugin.name || "").toLowerCase();
  if (["owner", "creator"].includes(name)) return "Owner";
  if (["kick", "remove", "promote", "demote", "tagall", "everyone", "groupinfo", "ginfo"].includes(name)) return "Group";
  if (["play", "yta", "ytv", "sticker", "vv"].includes(name)) return "Media";
  if (["ping", "alive", "menu", "help", "echo", "runtime", "uptime", "mode"].includes(name)) return "Utility";
  return "Other";
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

function buildCaption(plugins, message) {
  const star = ["✦", "✯", "✰", "◬"][Math.floor(Math.random() * 4)];
  const visible = plugins.filter((p) => !["menu", "help"].includes(String(p.name).toLowerCase()));
  const groups = new Map();

  for (const plugin of visible) {
    const category = getCategory(plugin);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(plugin);
  }

  const categories = [
    ...CATEGORY_ORDER.filter((category) => groups.has(category)),
    ...Array.from(groups.keys()).filter((category) => !CATEGORY_ORDER.includes(category)).sort(),
  ];

  const user = String(message?.pushName || message?.senderName || "User").replace(/[\r\n]+/g, "");
  const lines = [
    `╭━━〔 🌌 *${config.botName || "GALAXY-MD"}* 〕━━╮`,
    `┃ 👑 Owner: ${config.ownerNumber || "N/A"}`,
    `┃ 👤 User: ${user}`,
    `┃ ⚙️ Mode: ${config.mode || "public"}`,
    `┃ 🖥️ Server: ${os.platform() === "linux" ? "Linux" : os.platform()}`,
    `┃ 💾 RAM: ${bytesToSize(os.freemem())}/${bytesToSize(os.totalmem())}`,
    `┃ ✨ Version: ${config.version || "1.0.0"}`,
    `╰━━━━━━━━━━━━━━╯`,
    "",
  ];

  let number = 0;
  for (const category of categories) {
    lines.push(`╭─〔 *${category}* 〕`);
    const items = groups.get(category).sort((a, b) => a.name.localeCompare(b.name));
    for (const plugin of items) {
      number++;
      lines.push(`┃ ${star} ${number}. ${config.prefix}${plugin.name}`);
    }
    lines.push("╰────────────", "");
  }

  lines.push(`✦ Commands: ${visible.length}`, "🌌 *Powered by GALAXY-MD*");
  return lines.join("\n").trim();
}

function getMenuImage() {
  if (imageChecked) return cachedImage;
  imageChecked = true;
  const imagePath = path.join(__dirname, "..", "menu.png");
  try {
    if (fs.existsSync(imagePath)) cachedImage = fs.readFileSync(imagePath);
    else console.error(`[GALAXY-MD] Menu image not found at: ${imagePath}`);
  } catch (error) {
    console.error("[GALAXY-MD] Menu image read failed:", error.message || error);
  }
  return cachedImage;
}

module.exports = {
  name: "menu",
  aliases: ["help"],
  description: "Show available commands by category",
  async execute({ sock, jid, message, plugins }) {
    const pluginNames = plugins.map((p) => `${p.name}:${p.description || ""}:${p.category || ""}`).join("|");
    if (!cachedCaption || pluginNames !== cachedPluginNames) {
      cachedCaption = buildCaption(plugins, message);
      cachedPluginNames = pluginNames;
    }

    const image = getMenuImage();
    if (image) {
      try {
        await sock.sendMessage(jid, { image, caption: cachedCaption }, { quoted: message });
        return;
      } catch (error) {
        console.error("[GALAXY-MD] Menu image send failed:", error.message || error);
      }
    }

    await sock.sendMessage(jid, { text: cachedCaption }, { quoted: message });
  },
};
