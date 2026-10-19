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
            if (feature("antiviewonce") && !message.key?.fromMe && !senderIsAdmin && (message.message?.viewOnceMessage || message.message?.viewOnceMessageV2 || message.message?.viewOnceMessageV2Extension)) {
              await sock.sendMessage(jid, { text: "⛔ View-once media is disabled in this group." }).catch(() => {});
              if (botIsAdmin) await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
              continue;
            }
            if (feature("autoreply") && !message.key?.fromMe && text && !text.startsWith(config.prefix)) {
              const answer = data.autoReplyText?.[jid] || "Thanks for your message!";
              await sock.sendMessage(jid, { text: answer }, { quoted: message }).catch(() => {});
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
            ...(config.sudoNumbers || []),
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

          // Simple custom text commands saved by .setcmd name|response.
          let customData = {};
          try { customData = JSON.parse(fs.readFileSync(path.join(__dirname, "galaxy-data.json"), "utf8")); } catch {}
          const customReply = customData.customCommands?.[command];
          if (typeof customReply === "string") {
            await sock.sendMessage(jid, { text: customReply }, { quoted: message });
            continue;
          }

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
