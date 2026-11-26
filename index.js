"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const pino = require("pino");
const config = require("./config");

const SESSION_DIR = process.env.SESSION_DIR ? path.resolve(process.env.SESSION_DIR) : path.join(__dirname, "session");
const PLUGINS_DIR = path.join(__dirname, "plugins");
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

// Encodes any audio/video buffer to WhatsApp-compatible OGG/Opus without blocking the bot.
function encodeToOpus(input) {
  return new Promise((resolve, reject) => {
    const MAX_OUTPUT = 128 * 1024 * 1024;
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus",
      "-b:a", "64k", "-f", "ogg", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks = [];
    let size = 0;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1000); });
    child.stdin.on("error", () => {}); // ffmpeg may close the pipe early
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= MAX_OUTPUT) resolve(Buffer.concat(chunks));
      else reject(new Error("ffmpeg failed: " + (stderr.trim() || "exit " + code)));
    });
    child.stdin.end(input);
  });
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

    const pttBuffer = await encodeToOpus(mediaBuffer);
    if (!pttBuffer.length) throw new Error("Audio conversion returned an empty file.");
    await sock.sendMessage(jid, {
      audio: pttBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    }, { quoted: message });
    return true;
  } catch (error) {
    console.error("[GALAXY-MD] Audio-to-PTT conversion failed:", error.message || error);
    const messageText = /ENOENT|not found|spawn/i.test(String(error.message || error))
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

// ======================================================================
// Instances: the main bot (slot 1) plus optional clones (slots 2..N+1).
// A clone is another WhatsApp number linked with .pair; it runs the same
// plugins in this same process, with its own session folder (session2, ...).
// ======================================================================
const envMaxClones = parseInt(process.env.MAX_CLONES, 10);
const MAX_CLONES = Number.isFinite(envMaxClones) ? Math.max(0, Math.min(envMaxClones, 8)) : 4;
const CLONE_BASE = path.dirname(SESSION_DIR); // session2, session3 ... live next to the main session folder
const PAIR_WAIT_MS = (Number(process.env.PAIR_WAIT_SECONDS) > 0 ? Number(process.env.PAIR_WAIT_SECONDS) : 180) * 1000;
const PAIR_NUMBER_COOLDOWN_MS = 5 * 60 * 1000;
const PAIR_USER_COOLDOWN_MS = 60 * 1000;
const GROUP_CACHE_MS = 2 * 60 * 1000;

// Commands that change bot-wide state (owner, sudo, prefix, reboot, YouTube login, group
// automation ...). A clone owner must never be able to touch the main bot, so these are refused.
const CLONE_BLOCKED_COMMANDS = new Set([
  "pair", "clone",
  "autovv", "autodl", "auto",
  "reboot", "setprefix", "setbot", "setowner", "setsudo", "getsudo", "delsudo", "setvideo", "setimage",
  "ytlogin", "ytlogout",
  "welcome", "goodbye", "testwelcome", "testgoodbye", "antilink",
]);
// .autovv forwards view-once media to the MAIN owner, so it must never run for a clone.
const CLONE_PASSIVE_SKIP = new Set(["autovv"]);

const clones = new Map(); // slot -> instance
const pairAttempts = new Map(); // "n:<number>" / "u:<requester>" -> timestamp

const digitsOf = (value) => String(value || "").replace(/\D/g, "");

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function userError(message) {
  const error = new Error(message);
  error.user = true;
  return error;
}

const cloneDir = (slot) => path.join(CLONE_BASE, "session" + slot);

function numberFromCreds(creds) {
  return digitsOf(String(creds?.me?.id || "").split("@")[0].split(":")[0]);
}

function createInstance({ slot, number, dir }) {
  const isClone = slot !== 1;
  let cfg = config;
  if (isClone) {
    // Reads fall through to the main config (prefix, bot name ...); clone-specific values are own properties.
    cfg = Object.create(config);
    cfg.botNumber = number;
    cfg.ownerNumber = number;
    cfg.sudoNumbers = [];
    cfg.isClone = true;
    const savedMode = readJsonFile(path.join(dir, "clone-meta.json")).mode;
    cfg.mode = ["public", "private"].includes(savedMode) ? savedMode : config.mode;
  }
  return {
    slot, isClone, number, cfg,
    sessionDir: dir,
    tag: isClone ? `[GALAXY-MD #${slot}]` : "[GALAXY-MD]",
    sock: null, state: null,
    starting: false, stopped: false, destroyed: false, connected: false,
    retries: 0, reconnectTimer: null, pairTimer: null,
    onPairCode: null, onPairError: null, onFirstOpen: null,
    groupCache: new Map(), warnedGroups: new Set(),
  };
}

function isRegistered(inst) {
  return !!inst.state?.creds?.registered || !!readJsonFile(path.join(inst.sessionDir, "creds.json")).registered;
}

function removeCloneFolder(dir) {
  // never delete anything that is not a clone session folder
  if (path.dirname(dir) !== CLONE_BASE || !/^session[2-9]$/.test(path.basename(dir)) || dir === SESSION_DIR) {
    console.error("[GALAXY-MD] Refusing to delete a folder that is not a clone session:", dir);
    return;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {
    console.error("[GALAXY-MD] Could not delete clone session folder:", error.message || error);
  }
}

function destroyClone(inst, reason) {
  if (inst.destroyed) return;
  inst.destroyed = true;
  inst.stopped = true;
  clearTimeout(inst.reconnectTimer);
  clearTimeout(inst.pairTimer);
  inst.reconnectTimer = null;
  inst.pairTimer = null;
  // a dying socket must not save credentials into this folder (the slot may be reused at once)
  try { inst.sock?.ev?.removeAllListeners?.("creds.update"); } catch {}
  try { inst.sock?.end?.(undefined); } catch {}
  if (clones.get(inst.slot) === inst) clones.delete(inst.slot);
  removeCloneFolder(inst.sessionDir);
  // a write that was already in flight may recreate a file; clean once more, but only if
  // no new clone has taken this slot in the meantime (it would delete the new session)
  setTimeout(() => {
    if (!clones.has(inst.slot)) removeCloneFolder(inst.sessionDir);
  }, 3000).unref?.();
  console.log(`${inst.tag} Clone removed (${reason}). Session folder deleted: ${inst.sessionDir}`);
}

function scheduleRestart(inst, delay) {
  if (inst.stopped || inst.reconnectTimer) return;
  inst.reconnectTimer = setTimeout(() => {
    inst.reconnectTimer = null;
    if (inst.stopped) return;
    startBot(inst).catch((error) => console.error(inst.tag, "Restart error:", error));
  }, delay);
}

async function getGroupMetadata(inst, jid) {
  const hit = inst.groupCache.get(jid);
  if (hit && Date.now() - hit.at < GROUP_CACHE_MS) return hit.data;
  const data = await inst.sock.groupMetadata(jid);
  if (inst.groupCache.size > 500) inst.groupCache.clear();
  inst.groupCache.set(jid, { at: Date.now(), data });
  return data;
}

function browserFor(Browsers) {
  return typeof Browsers?.macOS === "function"
    ? Browsers.macOS("Safari")
    : ["Mac OS", "Safari", config.version];
}

async function handleCloneMode(inst, sock, jid, message, args, isPrivileged) {
  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: message });
  if (!isPrivileged) return reply("⛔ Only the owner of this bot number can change its mode.");
  const requested = String(args[0] || "").toLowerCase();
  if (!["public", "private"].includes(requested)) {
    return reply(`⚙️ Current mode: *${String(inst.cfg.mode).toUpperCase()}*\n\nUse:\n${config.prefix}mode public\n${config.prefix}mode private`);
  }
  inst.cfg.mode = requested;
  try {
    fs.writeFileSync(path.join(inst.sessionDir, "clone-meta.json"), JSON.stringify({ mode: requested }) + "\n");
  } catch {}
  return reply(requested === "public"
    ? "🌍 *PUBLIC MODE enabled.* Everyone can use this bot's commands."
    : "🔒 *PRIVATE MODE enabled.* Only this bot number can use commands.");
}

// ----------------------------------------------------------------------
// Clone manager (used by the .pair plugin)
// ----------------------------------------------------------------------
function freeSlot() {
  for (let slot = 2; slot <= MAX_CLONES + 1; slot++) {
    if (!clones.has(slot) && cloneDir(slot) !== SESSION_DIR) return slot;
  }
  return 0;
}

function checkCooldown(key, ms) {
  const now = Date.now();
  for (const [k, at] of pairAttempts) if (now - at > 10 * 60 * 1000) pairAttempts.delete(k);
  const last = pairAttempts.get(key);
  if (last && now - last < ms) return Math.ceil((ms - (now - last)) / 1000);
  pairAttempts.set(key, now);
  return 0;
}

const manager = {
  max: MAX_CLONES,
  count: () => clones.size,

  list: () => [...clones.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((inst) => ({ slot: inst.slot, number: inst.number, live: inst.connected })),

  async pair(rawNumber, { requester = "", bypassCooldown = false, onConnected = null } = {}) {
    if (MAX_CLONES === 0) throw userError("The clone feature is turned off (MAX_CLONES=0).");
    const number = digitsOf(rawNumber);
    if (!/^\d{8,15}$/.test(number)) {
      throw userError("Invalid number. Use country code + number, digits only (example: 919876543210).");
    }
    if (number === digitsOf(config.botNumber)) throw userError("This is the main bot number. Use another number.");
    for (const inst of clones.values()) {
      if (inst.number === number) throw userError("This number is already paired.");
    }
    if (!bypassCooldown) {
      const waitNumber = checkCooldown("n:" + number, PAIR_NUMBER_COOLDOWN_MS);
      if (waitNumber) throw userError(`Please wait ${waitNumber}s before trying this number again.`);
      if (requester) {
        const waitUser = checkCooldown("u:" + requester, PAIR_USER_COOLDOWN_MS);
        if (waitUser) throw userError(`Please wait ${waitUser}s before pairing again.`);
      }
    }
    const slot = freeSlot();
    if (!slot) throw userError(`All ${MAX_CLONES} clone slots are in use.`);

    const dir = cloneDir(slot);
    removeCloneFolder(dir); // leftovers from an earlier failed attempt
    fs.mkdirSync(dir, { recursive: true });

    const inst = createInstance({ slot, number, dir });
    inst.onFirstOpen = onConnected;
    clones.set(slot, inst); // reserve the slot right away

    let code;
    try {
      code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(userError("Could not get a pairing code in time. Please try again.")), 45000);
        inst.onPairCode = (value) => { clearTimeout(timer); resolve(value); };
        inst.onPairError = (error) => {
          clearTimeout(timer);
          reject(userError("Could not create a pairing code: " + String(error?.message || error).slice(0, 120)));
        };
        startBot(inst).catch((error) => { clearTimeout(timer); reject(error); });
      });
    } catch (error) {
      destroyClone(inst, "pairing code failed");
      throw error;
    }

    // the code must be entered in time, otherwise the half-made session is thrown away
    inst.pairTimer = setTimeout(() => {
      inst.pairTimer = null;
      if (!isRegistered(inst)) destroyClone(inst, "pairing code was not entered in time");
    }, PAIR_WAIT_MS);

    return { code, slot, used: clones.size, max: MAX_CLONES, waitSeconds: Math.round(PAIR_WAIT_MS / 1000) };
  },

  async remove(rawNumber) {
    const number = digitsOf(rawNumber);
    const inst = [...clones.values()].find((item) => item.number === number);
    if (!inst) return false;
    try { await inst.sock?.logout?.(); } catch {} // also removes the linked device in WhatsApp
    destroyClone(inst, "removed by the owner");
    return true;
  },
};

function restoreClones() {
  if (MAX_CLONES === 0) return;
  let started = 0;
  for (let slot = 2; slot <= MAX_CLONES + 1; slot++) {
    const dir = cloneDir(slot);
    if (dir === SESSION_DIR || !fs.existsSync(dir)) continue;
    const creds = readJsonFile(path.join(dir, "creds.json"));
    const number = numberFromCreds(creds);
    if (!creds.registered || !number) {
      console.log(`[GALAXY-MD] Removing unfinished clone session: ${dir}`);
      removeCloneFolder(dir);
      continue;
    }
    if (number === digitsOf(config.botNumber) || [...clones.values()].some((item) => item.number === number)) {
      console.warn(`[GALAXY-MD] Skipping duplicate clone session: ${dir}`);
      continue;
    }
    const inst = createInstance({ slot, number, dir });
    clones.set(slot, inst);
    setTimeout(() => {
      startBot(inst).catch((error) => console.error(inst.tag, "Clone start error:", error));
    }, 1500 * started++);
  }
  if (started) console.log(`[GALAXY-MD] Restoring ${started} clone bot(s).`);
}

// ----------------------------------------------------------------------
// One WhatsApp connection (main or clone)
// ----------------------------------------------------------------------
async function startBot(inst) {
  if (inst.starting || inst.stopped) return;
  inst.starting = true;
  const { cfg, tag } = inst;

  try {
    const baileys = await import("baileys");
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const Browsers = baileys.Browsers;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    const downloadMediaMessage = baileys.downloadMediaMessage;
    const DisconnectReason = baileys.DisconnectReason || {};
    const LOGGED_OUT = DisconnectReason.loggedOut ?? 401;
    const CONNECTION_REPLACED = DisconnectReason.connectionReplaced ?? 440;

    if (typeof makeWASocket !== "function" || typeof useMultiFileAuthState !== "function") {
      throw new Error("Required Baileys exports are missing. Check the installed Baileys version.");
    }

    fs.mkdirSync(inst.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(inst.sessionDir);
    inst.state = state;

    if (!state.creds.registered && !cfg.botNumber) {
      console.error(`${tag} BOT_NUMBER is missing. Add BOT_NUMBER=countrycode+number to your .env file.`);
      inst.starting = false;
      return;
    }

    let version = latestVersionCache;
    if (!version && typeof fetchLatestBaileysVersion === "function") {
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest && latest.version;
        if (version) latestVersionCache = version;
      } catch {
        console.warn(`${tag} Could not fetch WhatsApp version; using library defaults.`);
      }
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: browserFor(Browsers),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    inst.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    // keep the group metadata cache fresh
    sock.ev.on("groups.update", (updates) => {
      for (const item of updates || []) if (item?.id) inst.groupCache.delete(item.id);
    });

    // Send configured welcome/goodbye messages when group participants change (main bot only:
    // these settings belong to the main bot's groups).
    sock.ev.on("group-participants.update", async (update) => {
      inst.groupCache.delete(update.id);
      if (inst.isClone) return;
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
        const metadata = await getGroupMetadata(inst, update.id).catch(() => null);
        for (const participant of update.participants || []) {
          const userJid = typeof participant === "string" ? participant : (participant.id || participant.jid || "");
          if (!userJid) continue;
          const number = String(userJid).split("@")[0].split(":")[0];
          const values = {
            "$mention": "@" + number,
            "$user": number,
            "$group": String(metadata?.subject || "this group").replace(/[\r\n]+/g, " "),
            "$count": String(metadata?.participants?.length || 0),
            "$desc": String(metadata?.desc || "No description").replace(/[\r\n]+/g, " "),
            "$date": new Date().toLocaleDateString(),
            "$time": new Date().toLocaleTimeString(),
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
        console.error(`${tag} Welcome/goodbye event error:`, error.message || error);
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "connecting") {
        console.log(`${tag} Connecting to WhatsApp using saved session when available...`);
      }

      if (connection === "open") {
        inst.connected = true;
        inst.retries = 0;
        console.log(`${tag} ${config.botName} connected successfully! 🚀${inst.isClone ? " (clone " + inst.number + ")" : ""}`);
        if (inst.isClone) {
          clearTimeout(inst.pairTimer);
          inst.pairTimer = null;
          const notify = inst.onFirstOpen;
          inst.onFirstOpen = null;
          if (typeof notify === "function") Promise.resolve().then(notify).catch(() => {});
        }
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === LOGGED_OUT;

        console.log(
          `${tag} Connection closed.`,
          "Status:", statusCode ?? "unknown",
          "| Error:", lastDisconnect?.error?.message || "Unknown error",
          "| Detail:", lastDisconnect?.error?.output?.payload?.message || "No extra detail"
        );

        inst.starting = false;
        inst.connected = false;
        if (inst.stopped) return;

        if (inst.isClone) {
          // logged out from the phone, or the pairing never completed: this clone is finished
          if (loggedOut) return destroyClone(inst, "logged out from WhatsApp");
          if (!isRegistered(inst)) return destroyClone(inst, "pairing was not completed");
        }

        if (loggedOut) {
          console.log(`${tag} Logged out from WhatsApp. Delete the session folder (${inst.sessionDir}) and restart to link again.`);
          return;
        }

        inst.retries++;
        const delay = statusCode === CONNECTION_REPLACED
          ? 30000 // another copy uses this session; do not fight it
          : Math.min(3000 * 2 ** (inst.retries - 1), 60000);
        if (statusCode === CONNECTION_REPLACED) {
          console.warn(`${tag} This session is open somewhere else (conflict). Stop the other copy. Retrying in 30s.`);
        }
        scheduleRestart(inst, delay);
      }
    });

    if (!state.creds.registered) {
      const number = digitsOf(cfg.botNumber);
      if (number.length >= 8) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(number);
            if (inst.isClone) {
              if (typeof inst.onPairCode === "function") inst.onPairCode(code);
            } else {
              console.log("\n╔══════════════════════════════╗");
              console.log("║     GALAXY-MD PAIR CODE      ║");
              console.log("╚══════════════════════════════╝");
              console.log("\nPAIRING CODE:", code);
              console.log("WhatsApp → Linked devices → Link with phone number.\n");
            }
          } catch (error) {
            console.error(`${tag} Pairing code request failed:`, error.message || error);
            if (inst.isClone && typeof inst.onPairError === "function") inst.onPairError(error);
          }
        }, 2000);
      } else {
        console.error(`${tag} BOT_NUMBER looks invalid. Include country code and digits only, e.g. 919876543210.`);
        inst.starting = false;
        if (inst.isClone && typeof inst.onPairError === "function") inst.onPairError(new Error("invalid number"));
      }
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      const plugins = loadPlugins();
      const skipPassive = (plugin) => inst.isClone && CLONE_PASSIVE_SKIP.has(String(plugin.name).toLowerCase());

      for (const message of messages || []) {
        const receivedAt = Date.now();
        try {
          if (!message?.message) continue;
          const jid = message.key?.remoteJid;
          if (!jid || jid === "status@broadcast") continue;

          const text = getMessageText(message);

          // Mention audio is passive and must work regardless of group admin status.
          if (jid.endsWith("@g.us") && !message.key?.fromMe && !text.startsWith(config.prefix)) {
            const mentionPlugin = plugins.find((plugin) =>
              plugin.name === "mention" && typeof plugin.handleMessage === "function"
            );
            if (mentionPlugin) {
              const mentionHandled = await mentionPlugin.handleMessage({
                sock, jid, message, text, config: cfg, plugins,
              });
              if (mentionHandled) continue;
            }
          }

          const data = readJsonFile(path.join(__dirname, "galaxy-data.json"));

          // Group automation and moderation. Only the main bot does this: the settings are
          // stored per group for the main bot, and a clone must not act on them.
          if (jid.endsWith("@g.us") && !inst.isClone) {
            const feature = (name) => data.features?.[jid + ":" + name] === true;
            const senderIds = [message.key?.participant, message.key?.participantAlt].filter(Boolean);
            const metadata = await getGroupMetadata(inst, jid).catch(() => null);
            const participants = metadata?.participants || [];
            const participant = participants.find((p) => participantMatches(p, senderIds));
            const senderIsAdmin = !!(participant?.admin || participant?.superadmin);

            if (feature("welcome") && !message.key?.fromMe && message.messageStubType === 27) {
              await sock.sendMessage(jid, { text: "👋 Welcome to the group!", mentions: [message.key?.participant, message.key?.participantAlt].filter(Boolean) }).catch(() => {});
            }
            if (feature("antilink") && !message.key?.fromMe && !senderIsAdmin && /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/)/i.test(text)) {
              await sock.sendMessage(jid, { text: "⛔ Links are not allowed here. Removing the message." }).catch(() => {});
              await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
              continue;
            }
          }

          if (!text.startsWith(config.prefix)) {
            const convertedToPtt = await convertQuotedAudioToPtt({
              sock, jid, message, text, downloadMediaMessage,
            });
            if (convertedToPtt) continue;

            let replyHandled = false;
            for (const plugin of plugins) {
              if (typeof plugin.handleReply !== "function" || skipPassive(plugin)) continue;
              const handled = await plugin.handleReply({ sock, jid, message, text, config: cfg, plugins });
              if (handled) {
                replyHandled = true;
                break;
              }
            }
            if (replyHandled) continue;

            // Run passive message plugins (for example, the SUDO/bot mention audio response).
            let passivePluginHandled = false;
            for (const plugin of plugins) {
              if (typeof plugin.handleMessage !== "function" || skipPassive(plugin)) continue;
              const handled = await plugin.handleMessage({ sock, jid, message, text, config: cfg, plugins });
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
                  config: cfg,
                  plugins,
                  manager,
                  receivedAt,
                  isPrivileged: false,
                  setMode: (mode) => { cfg.mode = mode; },
                });
                continue;
              }
            }

            continue;
          }

          const senderIds = [
            message.key?.participant,
            message.key?.participantAlt,
            ...(message.key?.fromMe ? [sock.user?.id, sock.user?.lid, cfg.botNumber] : [message.key?.remoteJid]),
          ].filter(Boolean);
          const senderNumbers = senderIds
            .map((id) => String(id).split("@")[0].split(":")[0].replace(/\D/g, ""))
            .filter(Boolean);
          // A clone belongs only to its own number: the main owner/SUDO list does not apply to it.
          const allowedNumbers = inst.isClone
            ? [digitsOf(cfg.botNumber)].filter(Boolean)
            : [
              digitsOf(cfg.botNumber),
              digitsOf(data.ownerNumber || cfg.ownerNumber),
              ...(cfg.sudoNumbers || []),
              ...(Array.isArray(data.sudo) ? data.sudo : []),
            ].filter(Boolean);
          const isPrivileged = senderNumbers.some((number) =>
            allowedNumbers.some((allowed) => number === allowed || number.endsWith(allowed) || allowed.endsWith(number))
          );

          if (message.key?.fromMe && !isPrivileged) continue;
          if (cfg.mode === "private" && !isPrivileged) continue;

          const input = text.slice(config.prefix.length).trim();
          if (!input) continue;

          const [commandRaw, ...args] = input.split(/\s+/);
          const command = commandRaw.toLowerCase();
          const query = args.join(" ");

          // .mode on a clone only changes that clone (it never touches the main bot's mode file).
          if (inst.isClone && command === "mode") {
            await handleCloneMode(inst, sock, jid, message, args, isPrivileged);
            continue;
          }

          const plugin = plugins.find((item) =>
            item.name.toLowerCase() === command ||
            (Array.isArray(item.aliases) && item.aliases.some((alias) => String(alias).toLowerCase() === command))
          );
          if (!plugin) continue;

          if (inst.isClone && (CLONE_BLOCKED_COMMANDS.has(command) || CLONE_BLOCKED_COMMANDS.has(plugin.name.toLowerCase()))) {
            await sock.sendMessage(jid, { text: "⛔ This command is only available on the main bot." }, { quoted: message });
            continue;
          }

          await plugin.execute({
            sock, jid, message, args, query, command, config: cfg, plugins, manager,
            receivedAt, isPrivileged,
            setMode: (mode) => { cfg.mode = mode; },
          });
        } catch (error) {
          console.error(`${tag} Message handler error:`, error.message || error);
        }
      }
    });
  } catch (error) {
    console.error(`${tag} Startup error:`, error.stack || error);
    inst.starting = false;
    scheduleRestart(inst, 5000);
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

const mainInstance = createInstance({ slot: 1, number: digitsOf(config.botNumber), dir: SESSION_DIR });
startBot(mainInstance).catch((error) => console.error("[GALAXY-MD] Fatal startup error:", error));
restoreClones();
