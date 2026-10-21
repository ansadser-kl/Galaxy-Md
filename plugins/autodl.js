"use strict";

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "galaxy-data.json");

// Link host -> downloader plugin name.
// YouTube is intentionally missing (stays manual: .ytv / .video / .yta).
// To support a new site later: make its plugin, then add one line here.
const SITES = [
  { plugin: "insta", hosts: ["instagram.com", "instagr.am"] },
  { plugin: "fb", hosts: ["facebook.com", "fb.watch", "fb.com"] },
  { plugin: "tera", hosts: ["terabox.com", "1024terabox.com", "teraboxapp.com", "terabox.app", "4funbox.com"] },
  { plugin: "spotify", hosts: ["open.spotify.com"] },
];

const seen = new Set();

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}

function findTarget(text, plugins) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const url = match[0].replace(/[),.!?\]]+$/, "");
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  const site = SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith("." + h)));
  if (!site) return null;
  const plugin = plugins.find((p) => p.name.toLowerCase() === site.plugin);
  return plugin ? { plugin, url } : null;
}

module.exports = {
  name: "autodl",
  aliases: ["auto"],
  description: "Auto download links (Instagram, Facebook, Terabox, Spotify). Use .autodl on/off",
  category: "Downloader",

  // .autodl on | off | (status)
  async execute({ sock, jid, message, args, isPrivileged }) {
    const arg = String(args?.[0] || "").toLowerCase();
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });

    if (arg === "on" || arg === "off") {
      if (!isPrivileged) return reply("❌ Owner mathram use cheyyam.");
      const data = readData();
      data.autodl = arg === "on";
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
      return reply(arg === "on" ? "✅ Auto download ON" : "⛔ Auto download OFF");
    }

    const status = readData().autodl !== false ? "ON ✅" : "OFF ⛔";
    return reply(
      "Auto download: " + status +
      "\nSupported: Instagram, Facebook, Terabox, Spotify" +
      "\nYouTube: manual (.ytv / .video / .yta)" +
      "\n\nUse: .autodl on | .autodl off"
    );
  },

  // Runs for every normal (non-command) message.
  async handleReply({ sock, jid, message, text, config, plugins }) {
    const target = findTarget(text, plugins);
    if (!target) return false;

    const key = message.key || {};

    // Ignore messages sent by the bot itself (prevents loops).
    if (key.fromMe && String(key.id || "").startsWith("3EB0")) return true;

    if (readData().autodl === false) return true;
    if (config.mode === "private" && !key.fromMe) return true;

    // Avoid double processing of the same message.
    if (key.id) {
      if (seen.has(key.id)) return true;
      seen.add(key.id);
      if (seen.size > 200) seen.delete(seen.values().next().value);
    }

    try {
      await target.plugin.execute({
        sock,
        jid,
        message,
        text: target.url,
        args: [target.url],
        query: target.url,
        command: target.plugin.name,
        config,
        plugins,
        receivedAt: Date.now(),
        isPrivileged: false,
        setMode: (mode) => { config.mode = mode; },
      });
    } catch (error) {
      console.error("[GALAXY-MD] autodl failed:", error.message || error);
    }
    return true;
  },
};
