"use strict";

const config = require("../config");

const CATEGORY_ORDER = ["General", "Utility", "Group", "Media", "Owner", "Other"];
let cachedCaption = "";
let cachedPluginNames = "";

function getCategory(plugin) {
  if (plugin.category) return String(plugin.category);
  const name = String(plugin.name || "").toLowerCase();
  if (["ping", "alive", "menu", "help", "echo", "owner", "creator", "runtime", "uptime", "mode"].includes(name)) {
    return ["owner", "creator"].includes(name) ? "Owner" : "Utility";
  }
  if (["kick", "remove", "promote", "demote", "tagall", "everyone", "groupinfo", "ginfo"].includes(name)) return "Group";
  if (["play", "yta", "ytv", "sticker", "vv"].includes(name)) return "Media";
  return "Other";
}

function buildCaption(plugins) {
  const groups = new Map();
  const visiblePlugins = plugins.filter((plugin) => !["menu", "help"].includes(String(plugin.name).toLowerCase()));

  for (const plugin of visiblePlugins) {
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
    `┃ 🧩 Commands: ${visiblePlugins.length}`,
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
  return lines.join("\n").trim();
}

module.exports = {
  name: "menu",
  aliases: ["help"],
  description: "Show available commands by category",
  async execute({ sock, jid, message, plugins }) {
    const pluginNames = plugins.map((plugin) => `${plugin.name}:${plugin.description || ""}`).join("|");
    if (!cachedCaption || pluginNames !== cachedPluginNames) {
      cachedCaption = buildCaption(plugins);
      cachedPluginNames = pluginNames;
    }

    // Text-only avoids re-uploading menu.png on every command, which can be slow on any host.
    await sock.sendMessage(jid, { text: cachedCaption }, { quoted: message });
  },
};
