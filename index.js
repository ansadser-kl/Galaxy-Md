"use strict";

// GALAXY-MD v1.0.0 — CommonJS .js entry point.
// Baileys v7 is ESM, so it is loaded using dynamic import().

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const config = require("./config");

const SESSION_DIR = path.join(__dirname, "session");
let reconnectTimer = null;
let starting = false;

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

function makeMenu() {
  return [
    `╭━━〔 *${config.botName}* 〕━━╮`,
    "┃",
    "┃  .ping  — Check response",
    "┃  .alive — Bot status",
    "┃  .menu  — Show commands",
    "┃  .echo  — Repeat text",
    "┃",
    "╰━━━━━━━━━━━━━━━━━━╯",
    "_More commands will be added in future updates._",
  ].join("\n");
}

async function startBot() {
  if (starting) return;
  starting = true;

  try {
    const baileys = await import("baileys");
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    const DisconnectReason = baileys.DisconnectReason || {};

    if (typeof makeWASocket !== "function" || typeof useMultiFileAuthState !== "function") {
      throw new Error("Required Baileys exports are missing. Check the installed Baileys version.");
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    let version;
    if (typeof fetchLatestBaileysVersion === "function") {
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest && latest.version;
      } catch (error) {
        console.warn("[GALAXY-MD] Could not fetch WhatsApp version; using library defaults.");
      }
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["GALAXY-MD", "Chrome", config.version],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !state.creds.registered && !config.pairingNumber) {
        console.log("\n[GALAXY-MD] Scan QR in WhatsApp → Linked devices:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "connecting") {
        console.log("[GALAXY-MD] Connecting to WhatsApp...");
      }

      if (connection === "open") {
        console.log(`[GALAXY-MD] ${config.botName} connected successfully! 🚀`);
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.log(
          "[GALAXY-MD] Connection closed.",
          loggedOut ? "WhatsApp logged out; delete session and relink if needed." : "Reconnecting in 3 seconds..."
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

    // Optional phone-number pairing login: PAIRING_NUMBER=countrycode+number (digits only).
    if (!state.creds.registered && config.pairingNumber) {
      const number = String(config.pairingNumber).replace(/\D/g, "");
      if (number.length >= 8) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(number);
            console.log("\n[GALAXY-MD] Pairing code:", code);
            console.log("WhatsApp → Linked devices → Link with phone number.\n");
          } catch (error) {
            console.error("[GALAXY-MD] Pairing code request failed:", error.message || error);
          }
        }, 2000);
      } else {
        console.warn("[GALAXY-MD] PAIRING_NUMBER looks invalid; include country code and digits only.");
      }
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages || []) {
        try {
          if (!message?.message || message.key?.fromMe) continue;

          const jid = message.key?.remoteJid;
          if (!jid || jid === "status@broadcast") continue;

          const text = getMessageText(message);
          if (!text.startsWith(config.prefix)) continue;

          const input = text.slice(config.prefix.length).trim();
          if (!input) continue;

          const [commandRaw, ...args] = input.split(/\s+/);
          const command = commandRaw.toLowerCase();
          const query = args.join(" ");

          if (command === "ping") {
            await sock.sendMessage(jid, { text: "🏓 PONG!" }, { quoted: message });
          } else if (command === "alive") {
            await sock.sendMessage(
              jid,
              {
                text: `╭━━〔 *${config.botName}* 〕━━╮\n┃ Status: Online ✅\n┃ Prefix: ${config.prefix}\n┃ Version: ${config.version}\n╰━━━━━━━━━━━━━━━━━━╯`,
              },
              { quoted: message }
            );
          } else if (command === "menu" || command === "help") {
            await sock.sendMessage(jid, { text: makeMenu() }, { quoted: message });
          } else if (command === "echo") {
            await sock.sendMessage(
              jid,
              { text: query || `Usage: ${config.prefix}echo your text` },
              { quoted: message }
            );
          }
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

process.on("unhandledRejection", (error) => {
  console.error("[GALAXY-MD] Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[GALAXY-MD] Uncaught exception:", error);
});

console.log([
  "╔══════════════════════════════╗",
  "║        GALAXY-MD v1.0.0      ║",
  "║    CommonJS • Baileys 7 RC14 ║",
  "╚══════════════════════════════╝",
].join("\n"));

startBot().catch((error) => console.error("[GALAXY-MD] Fatal startup error:", error));
