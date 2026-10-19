"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const config = require("./config");

const SESSION_DIR = path.join(__dirname, "session");
const PLUGINS_DIR = path.join(__dirname, "plugins");
let reconnectTimer = null;
let starting = false;
let cachedPlugins = [];
let cachedPluginSignature = "";
let latestVersionCache = null;

function getMessageText(message) {
  const msg = message && message.message;
  if (!msg) return "";
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.templateButtonReplyMessage?.selectedId ||
    ""
  ).trim();
}

function loadPlugins() {
  let files;
  try {
    files = fs.readdirSync(PLUGINS_DIR).filter((name) => name.endsWith(".js")).sort();
  } catch (error) {
    if (error.code === "ENOENT") fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    files = [];
  }

  const signature = files.map((file) => {
    try {
      const stat = fs.statSync(path.join(PLUGINS_DIR, file));
      return file + ":" + stat.size + ":" + stat.mtimeMs;
    } catch {
      return file + ":missing";
    }
  }).join("|");

  if (signature === cachedPluginSignature) return cachedPlugins;

  const plugins = [];
  for (const file of files) {
    const fullPath = path.join(PLUGINS_DIR, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const plugin = require(fullPath);
      if (!plugin || typeof plugin.name !== "string" || typeof plugin.execute !== "function") {
        console.warn(`[GALAXY-MD] Skipping invalid plugin: ${file}`);
        continue;
      }
      plugins.push(plugin);
    } catch (error) {
      console.error(`[GALAXY-MD] Failed to load plugin ${file}:`, error.message || error);
    }
  }

  cachedPluginSignature = signature;
  cachedPlugins = plugins;
  return cachedPlugins;
}

async function startBot() {
  if (starting) return;
  starting = true;

  try {
    const baileys = await import("baileys");
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const Browsers = baileys.Browsers;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    const DisconnectReason = baileys.DisconnectReason || {};

    if (typeof makeWASocket !== "function" || typeof useMultiFileAuthState !== "function") {
      throw new Error("Required Baileys exports are missing. Check the installed Baileys version.");
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    if (!state.creds.registered && !config.botNumber) {
      console.error("[GALAXY-MD] BOT_NUMBER is missing. Add BOT_NUMBER=countrycode+number to your .env file.");
      starting = false;
      return;
    }

    let version = latestVersionCache;
    if (!version && typeof fetchLatestBaileysVersion === "function") {
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest && latest.version;
        if (version) latestVersionCache = version;
      } catch {
        console.warn("[GALAXY-MD] Could not fetch WhatsApp version; using library defaults.");
      }
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: typeof Browsers?.macOS === "function" ? Browsers.macOS("Safari") : ["Mac OS", "Safari", config.version],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    // Send configured welcome/goodbye messages when group participants change.
    sock.ev.on("group-participants.update", async (update) => {
      try {
        const dataFile = path.join(__dirname, "galaxy-data.json");
        let data = {};
        try { data = JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch {}
        const group = data.groupMessages?.[update.id];
        if (!group) return;
        const action = String(update.action || "").toLowerCase();
        const type = ["add", "invite", "join"].includes(action) ? "welcome"
          : ["remove", "leave", "reject"].includes(action) ? "goodbye" : "";
        const item = type && group[type];
        if (!item?.message || item.enabled === false) return;
        const metadata = await sock.groupMetadata(update.id).catch(() => ({}));
        for (const participant of update.participants || []) {
          const userJid = typeof participant === "string" ? participant : (participant.id || participant.jid || "");
          if (!userJid) continue;
          const number = String(userJid).split("@")[0].split(":")[0];
          const values = {
            "$mention": "@" + number,
            "$user": number,
            "$group": String(metadata.subject || "this group").replace(/[\\r\\n]+/g, " "),
            "$count": String(metadata.participants?.length || 0),
            "$desc": String(metadata.desc || "No description").replace(/[\\r\\n]+/g, " "),
            "$date": new Date().toLocaleDateString(),
            "$time": new Date().toLocaleTimeString()
          };
          let text = item.message;
          for (const [key, value] of Object.entries(values)) text = text.split(key).join(value);
          let imageUrl = "";
          if (text.includes("$pp")) {
            try { imageUrl = await sock.profilePictureUrl(userJid, "image"); } catch {}
            text = text.split("$pp").join("");
          }
          if (text.includes("$gpp")) {
            try {
              const groupPic = await sock.profilePictureUrl(update.id, "image");
              text = text.split("$gpp").join("");
              await sock.sendMessage(update.id, { image: { url: groupPic }, caption: text, mentions: [userJid] });
              continue;
            } catch { text = text.split("$gpp").join(""); }
          }
          if (imageUrl) {
            await sock.sendMessage(update.id, { image: { url: imageUrl }, caption: text, mentions: [userJid] });
          } else {
            await sock.sendMessage(update.id, { text, mentions: [userJid] });
          }
        }
      } catch (error) {
        console.error("[GALAXY-MD] Welcome/goodbye event error:", error.message || error);
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "connecting") {
        console.log("[GALAXY-MD] Connecting to WhatsApp using saved session when available...");
      }

      if (connection === "open") {
        console.log(`[GALAXY-MD] ${config.botName} connected successfully! 🚀`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(
          "[GALAXY-MD] Connection closed.",
          "Status:", statusCode ?? "unknown",
          "| Error:", lastDisconnect?.error?.message || "Unknown error",
          "| Detail:", lastDisconnect?.error?.output?.payload?.message || "No extra detail"
        );

        starting = false;
        if (!loggedOut && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startBot().catch((error) => console.error("[GALAXY-MD] Restart error:", error));
          }, 3000);
        }
      }
    });

    if (!state.creds.registered) {
      const number = String(config.botNumber).replace(/\D/g, "");
      if (number.length >= 8) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(number);
            console.log("\n╔══════════════════════════════╗");
            console.log("║     GALAXY-MD PAIR CODE      ║");
            console.log("╚══════════════════════════════╝");
            console.log("\nPAIRING CODE:", code);
            console.log("WhatsApp → Linked devices → Link with phone number.\n");
          } catch (error) {
            console.error("[GALAXY-MD] Pairing code request failed:", error.message || error);
          }
        }, 2000);
      } else {
        console.error("[GALAXY-MD] BOT_NUMBER looks invalid. Include country code and digits only, e.g. 919876543210.");
        starting = false;
      }
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      const plugins = loadPlugins();

      for (const message of messages || []) {
        const receivedAt = Date.now();
        try {
          if (!message?.message) continue;
          const jid = message.key?.remoteJid;
          if (!jid || jid === "status@broadcast") continue;

          const text = getMessageText(message);
          const dataFile = path.join(__dirname, "galaxy-data.json");
          let data = {};
          try { data = JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch {}

          // Group automation and moderation are handled for ordinary messages too.
          if (jid.endsWith("@g.us")) {
            const feature = (name) => data.features?.[jid + ":" + name] === true;
            const senderJid = message.key?.participant || message.key?.participantAlt || "";
            const senderNumber = String(senderJid).split("@")[0].split(":")[0].replace(/\D/g, "");
            const botNumber = String(config.botNumber || sock.user?.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
            const metadata = await sock.groupMetadata(jid).catch(() => null);
            const participant = metadata?.participants?.find(p => p.id === senderJid || p.lid === senderJid || String(p.id || "").split(":")[0] === String(senderJid).split(":")[0]);
            const senderIsAdmin = !!(participant?.admin || participant?.superadmin);
            const botParticipant = metadata?.participants?.find(p => p.id === sock.user?.id || p.lid === sock.user?.lid || String(p.id || "").split(":")[0] === botNumber);
            const botIsAdmin = !!(botParticipant?.admin || botParticipant?.superadmin);

            if (feature("welcome") && !message.key?.fromMe && message.messageStubType === 27) {
              await sock.sendMessage(jid, { text: "👋 Welcome to the group!", mentions: [senderJid].filter(Boolean) }).catch(() => {});
            }
            if (feature("antilink") && !message.key?.fromMe && !senderIsAdmin && /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/)/i.test(text) && botIsAdmin) {
              await sock.sendMessage(jid, { text: "⛔ Links are not allowed here. Removing the message." }).catch(() => {});
              await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
              continue;
            }
          }

          if (!text.startsWith(config.prefix)) continue;

          const senderIds = [
            message.key?.participant,
            message.key?.participantAlt,
            ...(message.key?.fromMe ? [sock.user?.id, sock.user?.lid, config.botNumber] : [message.key?.remoteJid]),
          ].filter(Boolean);
          const senderNumbers = senderIds
            .map((id) => String(id).split("@")[0].split(":")[0].replace(/\D/g, ""))
            .filter(Boolean);
          const allowedNumbers = [
            String(config.botNumber || "").replace(/\D/g, ""),
            String(data.ownerNumber || config.ownerNumber || "").replace(/\D/g, ""),
            ...(config.sudoNumbers || []),
            ...(Array.isArray(data.sudo) ? data.sudo : []),
          ].filter(Boolean);
          const isPrivileged = senderNumbers.some((number) =>
            allowedNumbers.some((allowed) => number === allowed || number.endsWith(allowed) || allowed.endsWith(number))
          );

          if (message.key?.fromMe && !isPrivileged) continue;
          if (config.mode === "private" && !isPrivileged) continue;

          const input = text.slice(config.prefix.length).trim();
          if (!input) continue;

          const [commandRaw, ...args] = input.split(/\s+/);
          const command = commandRaw.toLowerCase();
          const query = args.join(" ");

          const plugin = plugins.find((item) =>
            item.name.toLowerCase() === command ||
            (Array.isArray(item.aliases) && item.aliases.some((alias) => String(alias).toLowerCase() === command))
          );
          if (!plugin) continue;

          await plugin.execute({
            sock, jid, message, args, query, command, config, plugins,
            receivedAt, isPrivileged,
            setMode: (mode) => { config.mode = mode; },
          });
        } catch (error) {
          console.error("[GALAXY-MD] Message handler error:", error.message || error);
        }
      }
    });
  } catch (error) {
    console.error("[GALAXY-MD] Startup error:", error.stack || error);
    starting = false;

    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot().catch((err) => console.error("[GALAXY-MD] Restart error:", err));
      }, 5000);
    }
  }
}

process.on("unhandledRejection", (error) => console.error("[GALAXY-MD] Unhandled rejection:", error));
process.on("uncaughtException", (error) => console.error("[GALAXY-MD] Uncaught exception:", error));

console.log([
  "╔══════════════════════════════╗",
  "║        GALAXY-MD v1.0.0      ║",
  "║    CommonJS • Baileys 7 RC14 ║",
  "╚══════════════════════════════╝",
].join("\n"));

startBot().catch((error) => console.error("[GALAXY-MD] Fatal startup error:", error));
