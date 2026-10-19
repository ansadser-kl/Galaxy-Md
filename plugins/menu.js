"use strict";

const os = require("os");
const https = require("https");
const http = require("http");
const config = require("../config");

const MENU_IMAGE_URL = "https://i.ibb.co/chSg1dRQ/temp.jpg";
const CATEGORY_ORDER = ["General", "Utility", "Group", "Media", "Owner", "Other"];
let imageBuffer = null;
let imagePromise = null;
let cachedCaption = "";
let cachedPluginSignature = "";

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

function downloadImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many menu image redirects"));
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { timeout: 10000, headers: { "User-Agent": "GALAXY-MD" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        return resolve(downloadImage(nextUrl, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error("Menu image HTTP status " + response.statusCode));
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > 8 * 1024 * 1024) {
          request.destroy(new Error("Menu image exceeds 8 MB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Menu image download timed out")));
    request.on("error", reject);
  });
}

function getImage() {
  if (imageBuffer) return Promise.resolve(imageBuffer);
  if (!imagePromise) {
    imagePromise = downloadImage(MENU_IMAGE_URL)
      .then((buffer) => {
        imageBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.error("[GALAXY-MD] Menu image preload failed:", error.message || error);
        imagePromise = null;
        return null;
      });
  }
  return imagePromise;
}

// Preload the image in the background so the first menu request has a better chance of using cached bytes.
getImage().catch(() => {});

function buildCaption(plugins, message, cfg) {
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
    `╭━━〔 🌌 *${cfg.botName || "GALAXY-MD"}* 〕━━╮`,
    `┃ 👑 Owner: ${cfg.ownerNumber || "N/A"}`,
    `┃ 👤 User: ${user}`,
    `┃ ⚙️ Mode: ${cfg.mode || "public"}`,
    `┃ 🖥️ Server: ${os.platform() === "linux" ? "Linux" : os.platform()}`,
    `┃ 💾 RAM: ${bytesToSize(os.freemem())}/${bytesToSize(os.totalmem())}`,
    `┃ ✨ Version: ${cfg.version || "1.0.0"}`,
    "╰━━━━━━━━━━━━━━╯",
    "",
  ];

  let number = 0;
  for (const category of categories) {
    lines.push(`╭─〔 *${category}* 〕`);
    for (const plugin of groups.get(category).sort((a, b) => a.name.localeCompare(b.name))) {
      number++;
      lines.push(`┃ ${star} ${number}. ${cfg.prefix}${plugin.name}`);
    }
    lines.push("╰────────────", "");
  }

  lines.push(`✦ Commands: ${visible.length}`);
  return lines.join("\n").trim();
}

module.exports = {
  name: "menu",
  aliases: ["help"],
  description: "Show available commands by category",
  async execute({ sock, jid, message, plugins, config: runtimeConfig }) {
    const cfg = runtimeConfig || config;
    const signature = plugins.map((p) => `${p.name}:${p.description || ""}:${p.category || ""}`).join("|");
    if (!cachedCaption || signature !== cachedPluginSignature) {
      cachedCaption = buildCaption(plugins, message, cfg);
      cachedPluginSignature = signature;
    } else {
      // Refresh the requester-specific line without rebuilding all command categories.
      cachedCaption = buildCaption(plugins, message, cfg);
    }

    try {
      const image = await getImage();
      if (!image) throw new Error("Cached menu image is unavailable");
      await sock.sendMessage(jid, {
        image,
        caption: cachedCaption,
        footer: " ",
        buttons: [
          { buttonId: ".alive", buttonText: { displayText: "ALIVE" }, type: 1 },
          { buttonId: ".ping", buttonText: { displayText: "PING" }, type: 1 },
          {
            type: 2,
            urlButton: {
              displayText: "GROUP LINK",
              url: "https://chat.whatsapp.com/EqdvEYC3bxN3IPa3Nlzw7l?s=cl&p=a&mlu=4&ilr=4"
            }
          }
        ],
        headerType: 4
      }, { quoted: message });
    } catch (error) {
      console.error("[GALAXY-MD] Menu image send failed:", error.message || error);
      await sock.sendMessage(jid, { text: cachedCaption }, { quoted: message });
    }
  },
};
