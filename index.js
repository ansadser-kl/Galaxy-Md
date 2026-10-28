"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pino = require("pino");
const config = require("./config");
const { handleAIMessage } = require("./ai-agent");

const SESSION_DIR = path.join(__dirname, "session");
const PLUGINS_DIR = path.join(__dirname, "plugins");
let reconnectTimer = null;
let starting = false;
let cachedPlugins = [];
let cachedPluginSignature = "";
let latestVersionCache = null;

function unwrapMessage(message) {
  let current = message || {};
  while (current.ephemeralMessage?.message || current.viewOnceMessage?.message ||
         current.viewOnceMessageV2?.message || current.documentWithCaptionMessage?.message) {
    current = current.ephemeralMessage?.message || current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message || current.documentWithCaptionMessage?.message;
  }
  return current;
}

function getQuotedMessage(message, jid) {
  const msg = unwrapMessage(message?.message);
  const contextInfo = msg?.extendedTextMessage?.contextInfo ||
    msg?.imageMessage?.contextInfo || msg?.videoMessage?.contextInfo ||
    msg?.documentMessage?.contextInfo || msg?.audioMessage?.contextInfo ||
    msg?.stickerMessage?.contextInfo;
  if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) return null;
  return {
    key: {
      remoteJid: jid,
      id: contextInfo.stanzaId,
      participant: contextInfo.participant || undefined,
      fromMe: false,
    },
    message: contextInfo.quotedMessage,
  };
}

function isVoiceNoteRequest(text) {
  return /(?:voice\s*note|voice\s*message|\bptt\b|\bvn\b|voice\s*note\s*aakk|voice\s*note\s*akk|vn\s*aakk|vn\s*akk|വോയ്സ്\s*നോട്ട്|വോയിസ്\s*നോട്ട്|വോയ്സ്\s*മെസേജ്|വോയിസ്\s*മെസേജ്)/i.test(String(text || ""));
}

function getAudioMedia(message) {
  const msg = unwrapMessage(message?.message);
  if (!msg) return null;
  if (msg.audioMessage) return { media: msg.audioMessage, mimetype: msg.audioMessage.mimetype || "audio/ogg" };
  if (msg.documentMessage && /^audio\//i.test(msg.documentMessage.mimetype || "")) {
    return { media: msg.documentMessage, mimetype: msg.documentMessage.mimetype };
  }
  if (msg.videoMessage) return { media: msg.videoMessage, mimetype: msg.videoMessage.mimetype || "video/mp4" };
  return null;
}

async function convertQuotedAudioToPtt({ sock, jid, message, text, downloadMediaMessage }) {
  if (!isVoiceNoteRequest(text)) return false;
  const quoted = getQuotedMessage(message, jid);
  if (!quoted) return false;
  const audio = getAudioMedia(quoted);
  if (!audio) return false;

  try {
    if (typeof downloadMediaMessage !== "function") {
      throw new Error("Baileys media download is unavailable in this installed version.");
    }
    const mediaBuffer = await downloadMediaMessage(quoted, "buffer", {}, {
      logger: pino({ level: "silent" }),
      reuploadRequest: sock.updateMediaMessage,
    });
    if (!Buffer.isBuffer(mediaBuffer) || mediaBuffer.length === 0) {
      throw new Error("The replied audio could not be downloaded.");
    }

    // Encode the source as WhatsApp-compatible OGG/Opus PTT audio.
    const pttBuffer = execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus",
      "-b:a", "64k", "-f", "ogg", "pipe:1",
    ], {
      input: mediaBuffer,
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120000,
    });

    if (!pttBuffer.length) throw new Error("Audio conversion returned an empty file.");
    await sock.sendMessage(jid, {
      audio: pttBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    }, { quoted: message });
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] Audio-to-PTT conversion failed:", error.message || error);
    const messageText = /ENOENT|not found|spawn ffmpeg/i.test(String(error.message || error))
      ? "Voice note conversion-inu server-il ffmpeg install cheyyanam."
      : "Ee audio voice note aakkan kazhinjilla. Vere audio file try cheyyu.";
    await sock.sendMessage(jid, { text: messageText }, { quoted: message }).catch(() => {});
    return true;
  }
}

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

function normalizeJid(value) {
  return String(value || "").trim().toLowerCase().replace(/:\d+(?=@)/, "");
}

function participantMatches(participant, identifiers) {
  if (!participant) return false;
  const participantIds = [participant.id, participant.lid, participant.jid].map(normalizeJid).filter(Boolean);
  const wantedIds = identifiers.map(normalizeJid).filter(Boolean);
  return participantIds.some((candidate) => wantedIds.includes(candidate));
}

function getAutoDownloadPlugin(text, plugins) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;

  const url = match[0].replace(/[),.!?\]]+$/, "");
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  // YouTube stays manual: use .ytv, .video, or .yta.
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be" || hostname === "m.youtube.com" ||
      hostname === "music.youtube.com") {
    return null;
  }

  const matches = [
    { name: "insta", hosts: ["instagram.com", "instagr.am"] },
    { name: "fb", hosts: ["facebook.com", "fb.watch", "fb.com"] },
    { name: "tera", hosts: ["terabox.com", "1024terabox.com", "teraboxapp.com", "terabox.app", "4funbox.com"] },
    { name: "spotify", hosts: ["open.spotify.com"] },
  ];

  for (const entry of matches) {
    if (entry.hosts.some((host) => hostname === host || hostname.endsWith("." + host))) {
      const plugin = plugins.find((item) => item.name.toLowerCase() === entry.name);
      if (plugin) return { plugin, url };
    }
  }

  return null;
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
    const downloadMediaMessage = baileys.downloadMediaMessage;
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
        const metadata = await sock.groupMetadata(update.id).catch(() => null);
        if (!metadata) return;
        const botNumber = String(config.botNumber || "").replace(/\D/g, "");
        const botIds = [sock.user?.id, sock.user?.lid, botNumber ? botNumber + "@s.whatsapp.net" : ""].filter(Boolean);
        const botParticipant = (metadata.participants || []).find((p) => participantMatches(p, botIds));
        if (!(botParticipant?.admin || botParticipant?.superadmin)) {
          console.warn("[GALAXY-MD] Skipping group welcome/goodbye: bot is not confirmed as a group admin.");
          return;
        }
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

          // Mention audio is passive and must work even when the bot is not a group admin.
          // Run it before group metadata/admin checks so admin status cannot block this feature.
          if (jid.endsWith("@g.us") && !message.key?.fromMe && !text.startsWith(config.prefix)) {
            const mentionPlugin = plugins.find((plugin) =>
              plugin.name === "mention" && typeof plugin.handleMessage === "function"
            );
            if (mentionPlugin) {
              const mentionHandled = await mentionPlugin.handleMessage({
                sock, jid, message, text, config, plugins,
              });
              if (mentionHandled) continue;
            }
          }

          const dataFile = path.join(__dirname, "galaxy-data.json");
          let data = {};
          try { data = JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch {}

          // Group automation and moderation are handled for ordinary messages too.
          let senderIsAdmin = false;
          let botIsAdmin = false;
          if (jid.endsWith("@g.us")) {
            const feature = (name) => data.features?.[jid + ":" + name] === true;
            const senderIds = [message.key?.participant, message.key?.participantAlt].filter(Boolean);
            const botNumber = String(config.botNumber || "").replace(/\D/g, "");
            const botIds = [
              sock.user?.id,
              sock.user?.lid,
              botNumber ? botNumber + "@s.whatsapp.net" : "",
            ].filter(Boolean);
            const metadata = await sock.groupMetadata(jid).catch((error) => {
              console.warn("[GALAXY-MD] Could not fetch group metadata:", error.message || error);
              return null;
            });
            const participants = metadata?.participants || [];
            const participant = participants.find((p) => participantMatches(p, senderIds));
            senderIsAdmin = !!(participant?.admin || participant?.superadmin);
            const botParticipant = participants.find((p) => participantMatches(p, botIds));
            botIsAdmin = !!(botParticipant?.admin || botParticipant?.superadmin);
            if (!botIsAdmin) {
              // Do not block normal bot commands when the bot is not a group admin.
              // The AI handler independently refuses group AI unless botIsAdmin is true.
              console.warn("[GALAXY-MD] Bot is not confirmed as a group admin; group-admin features and group AI are disabled.");
            } else {
              if (feature("welcome") && !message.key?.fromMe && message.messageStubType === 27) {
                await sock.sendMessage(jid, { text: "👋 Welcome to the group!", mentions: [message.key?.participant, message.key?.participantAlt].filter(Boolean) }).catch(() => {});
              }
              if (feature("antilink") && !message.key?.fromMe && !senderIsAdmin && /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/)/i.test(text)) {
                await sock.sendMessage(jid, { text: "⛔ Links are not allowed here. Removing the message." }).catch(() => {});
                await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
                continue;
              }
            }
          }

          // AI is opt-in per chat. Use .ai on / .ai off to control it.
          const aiToggleMatch = text.match(new RegExp("^" + config.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\          if (!text.startsWith(config.prefix)) {
            const convertedToPtt = await convertQuotedAudioToPtt({") + "ai(?:\\s+(on|off|status))?\\s*$", "i"));
          if (aiToggleMatch) {
            const action = String(aiToggleMatch[1] || "status").toLowerCase();
            const isGroupChat = jid.endsWith("@g.us");
            const trustedIds = [
              message.key?.participant,
              message.key?.participantAlt,
              ...(message.key?.fromMe ? [sock.user?.id, sock.user?.lid, config.botNumber] : [message.key?.remoteJid]),
            ].filter(Boolean);
            const trustedNumbers = trustedIds.map((id) => String(id).split("@")[0].split(":")[0].replace(/\\D/g, "")).filter(Boolean);
            const trustedUsers = [
              String(config.botNumber || "").replace(/\\D/g, ""),
              String(data.ownerNumber || config.ownerNumber || "").replace(/\\D/g, ""),
              ...(config.sudoNumbers || []),
              ...(Array.isArray(data.sudo) ? data.sudo : []),
            ].filter(Boolean);
            const isBotOwnerOrSudo = trustedNumbers.some((number) =>
              trustedUsers.some((allowed) => number === allowed || number.endsWith(allowed) || allowed.endsWith(number))
            );

            if (isGroupChat && !senderIsAdmin && !isBotOwnerOrSudo) {
              await sock.sendMessage(jid, { text: "AI on/off maattan group admin allenkil bot owner/SUDO aayirikkanam." }, { quoted: message });
              continue;
            }
            if (isGroupChat && action === "on" && !botIsAdmin) {
              await sock.sendMessage(jid, { text: "AI enable cheyyan njan ee groupil admin aayirikkanam." }, { quoted: message });
              continue;
            }

            data.aiChats = data.aiChats && typeof data.aiChats === "object" ? data.aiChats : {};
            if (action === "on") data.aiChats[jid] = true;
            else if (action === "off") data.aiChats[jid] = false;

            try {
              fs.writeFileSync(dataFile, JSON.stringify(data, null, 2) + "\\n", "utf8");
            } catch (error) {
              console.error("[GALAXY-MD] Could not save AI chat setting:", error.message || error);
              await sock.sendMessage(jid, { text: "AI setting save cheyyan pattiyilla. File permission check cheyyu." }, { quoted: message });
              continue;
            }

            const enabled = data.aiChats[jid] === true;
            const statusText = action === "on"
              ? "AI enabled for this chat."
              : action === "off"
                ? "AI disabled for this chat."
                : (enabled ? "AI is ON in this chat." : "AI is OFF in this chat.");
            await sock.sendMessage(jid, { text: statusText + "\\nCommands: " + config.prefix + "ai on | " + config.prefix + "ai off | " + config.prefix + "ai status" }, { quoted: message });
            continue;
          }

          if (!text.startsWith(config.prefix)) {
            const convertedToPtt = await convertQuotedAudioToPtt({
              sock, jid, message, text, downloadMediaMessage,
            });
            if (convertedToPtt) continue;

            let replyHandled = false;
            for (const plugin of plugins) {
              if (typeof plugin.handleReply !== "function") continue;
              const handled = await plugin.handleReply({ sock, jid, message, text, config, plugins });
              if (handled) {
                replyHandled = true;
                break;
              }
            }
            if (replyHandled) continue;

            // Run passive message plugins (for example, the SUDO/bot mention audio response).
            let passivePluginHandled = false;
            for (const plugin of plugins) {
              if (typeof plugin.handleMessage !== "function") continue;
              const handled = await plugin.handleMessage({ sock, jid, message, text, config, plugins });
              if (handled) {
                passivePluginHandled = true;
                break;
              }
            }
            if (passivePluginHandled) continue;

            // Deterministic auto-download runs before AI so a normal reply cannot swallow a supported URL.
            // YouTube links are intentionally excluded and remain command-based.
            if (!message.key?.fromMe && text) {
              const autoDownload = getAutoDownloadPlugin(text, plugins);
              if (autoDownload) {
                await autoDownload.plugin.execute({
                  sock,
                  jid,
                  message,
                  text: autoDownload.url,
                  args: [autoDownload.url],
                  query: autoDownload.url,
                  command: autoDownload.plugin.name,
                  config,
                  plugins,
                  receivedAt,
                  isPrivileged: false,
                  setMode: (mode) => { config.mode = mode; },
                });
                continue;
              }
            }

            // Gemini AI: DMs respond to readable text; groups only when this bot is an admin.
            const aiHandled = await handleAIMessage({
              sock, jid, message, text, config, plugins, receivedAt,
              senderIsAdmin, botIsAdmin,
              aiEnabled: data.aiChats?.[jid] === true,
              setMode: (mode) => { config.mode = mode; },
            });
            if (aiHandled) continue;
            continue;
          }

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
  "║        GALAXY-MD v2.0.0      ║",
  "║    CommonJS • Baileys 7 RC14 ║",
  "╚══════════════════════════════╝",
].join("\n"));

startBot().catch((error) => console.error("[GALAXY-MD] Fatal startup error:", error));
