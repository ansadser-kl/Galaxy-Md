"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../config");

const CATEGORY_ORDER = ["General", "Utility", "Group", "Media", "Owner", "Other"];

function getCategory(plugin) {
  if (plugin.category) return String(plugin.category);
  const name = String(plugin.name || "").toLowerCase();
  if (["ping", "alive", "menu", "help", "echo", "owner", "creator", "runtime", "uptime"].includes(name)) {
    return ["owner", "creator"].includes(name) ? "Owner" : "Utility";
  }
  if (["kick", "remove", "promote", "demote", "tagall", "everyone", "groupinfo", "ginfo"].includes(name)) return "Group";
  if (["play", "yta", "ytv", "sticker", "vv"].includes(name)) return "Media";
  return "Other";
}

module.exports = {
  name: "menu",
  aliases: ["help"],
  description: "Show available commands by category",
  async execute({ sock, jid, message, plugins }) {
    const groups = new Map();

    for (const plugin of plugins) {
      if (["menu", "help"].includes(String(plugin.name).toLowerCase())) continue;
      const category = getCategory(plugin);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(plugin);
    }

    const categories = [
      ...CATEGORY_ORDER.filter((category) => groups.has(category)),
      ...Array.from(groups.keys()).filter((category) => !CATEGORY_ORDER.includes(category)).sort(),
    ];

    const lines = [
      `╭━━━〔 🌌 *${config.botName}* 〕━━━╮`,
      `┃ ✨ Version: ${config.version}`,
      `┃ 🔹 Prefix: ${config.prefix}`,
      `┃ 🧩 Commands: ${plugins.filter((p) => !["menu", "help"].includes(String(p.name).toLowerCase())).length}`,
      `╰━━━━━━━━━━━━━━━━━━━━━━╯`,
      "",
    ];

    for (const category of categories) {
      lines.push(`╭━━〔 ✦ *${category.toUpperCase()}* ✦ 〕━━╮`);
      for (const plugin of groups.get(category).sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`┃ ✧ ${config.prefix}${plugin.name}`);
        if (plugin.description) lines.push(`┃   └ ${plugin.description}`);
      }
      lines.push("╰━━━━━━━━━━━━━━━━━━━━╯", "");
    }

    lines.push("🌠 *GALAXY-MD* • Powered by plugins");

    const imagePath = path.join(__dirname, "..", "menu.png");
    const caption = lines.join("\n").trim();
    if (fs.existsSync(imagePath)) {
      await sock.sendMessage(jid, { image: fs.readFileSync(imagePath), caption }, { quoted: message });
    } else {
      await sock.sendMessage(jid, { text: `${caption}\n\n⚠️ menu.png not found in bot main folder.` }, { quoted: message });
    }
  },
};
