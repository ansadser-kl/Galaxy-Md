"use strict";

const AUDIOS = [
  "https://galaxy.anuansad50.workers.dev/f/-1793084810671.galaxy-upload-1793084810583",
  "https://galaxy.anuansad50.workers.dev/f/-1793084817481.galaxy-upload-1793084817415",
  "https://galaxy.anuansad50.workers.dev/f/-1793084824776.galaxy-upload-1793084824729",
];

const IMAGES = [
  "https://galaxy.anuansad50.workers.dev/f/-1793085072726.galaxy-upload-1793085072674",
];

const TITLE = "GALAXY-MD";
const BODY = "ANSAD SER";
const SOURCE_URL = "https://www.instagram.com/___ansad_";

function digits(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function normalizeJid(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");
}

function unwrapMessage(message) {
  let current = message || {};
  for (let i = 0; i < 6; i++) {
    const next = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function getMentionContexts(message) {
  const msg = unwrapMessage(message?.message);
  const candidates = [
    msg.extendedTextMessage?.contextInfo,
    msg.imageMessage?.contextInfo,
    msg.videoMessage?.contextInfo,
    msg.documentMessage?.contextInfo,
    msg.audioMessage?.contextInfo,
    msg.stickerMessage?.contextInfo,
    msg.buttonsResponseMessage?.contextInfo,
    msg.templateButtonReplyMessage?.contextInfo,
    msg.messageContextInfo,
  ];
  return candidates.filter(Boolean);
}

async function fetchBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Media fetch failed with status " + response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Media fetch returned an empty file");
  return buffer;
}

module.exports = {
  name: "mention",
  aliases: [],
  description: "Send random voice-note audio with thumbnail when the bot is mentioned",
  async execute() {},

  async handleMessage({ sock, jid, message, text, config }) {
    if (message?.key?.fromMe || !jid?.endsWith("@g.us")) return false;

    const configuredNumbers = [
      config.botNumber,
      ...(Array.isArray(config.sudoNumbers) ? config.sudoNumbers : []),
    ].map(digits).filter(Boolean);

    const botJids = [
      sock.user?.id,
      sock.user?.lid,
      ...configuredNumbers.map((number) => number + "@s.whatsapp.net"),
    ].map(normalizeJid).filter(Boolean);

    const contexts = getMentionContexts(message);
    const mentionedJids = contexts.flatMap((context) =>
      Array.isArray(context.mentionedJid) ? context.mentionedJid : []
    ).map(normalizeJid).filter(Boolean);

    const mentionedNumbers = mentionedJids.map(digits).filter(Boolean);
    const targets = new Set(configuredNumbers);
    const directJidMatch = mentionedJids.some((mentioned) => botJids.includes(mentioned));
    const numberMatch = mentionedNumbers.some((mentioned) =>
      [...targets].some((target) => mentioned === target || mentioned.endsWith(target) || target.endsWith(mentioned))
    );
    const textMatch = [...targets].some((number) => String(text || "").includes("@" + number));
    const isMentioned = directJidMatch || numberMatch || textMatch;

    if (!isMentioned) return false;

    console.log("[GALAXY-MD] Bot mention detected; preparing audio reply.");

    try {
      const audioUrl = AUDIOS[Math.floor(Math.random() * AUDIOS.length)];
      const imageUrl = IMAGES[Math.floor(Math.random() * IMAGES.length)];
      const [audio, thumbnail] = await Promise.all([
        fetchBuffer(audioUrl),
        fetchBuffer(imageUrl).catch((error) => {
          console.warn("[GALAXY-MD] Mention thumbnail unavailable:", error.message || error);
          return null;
        }),
      ]);

      await sock.sendMessage(jid, {
        audio,
        mimetype: "audio/mp4",
        ptt: true,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          externalAdReply: {
            title: TITLE,
            body: BODY,
            mediaType: 1,
            ...(thumbnail ? { thumbnail } : {}),
            sourceUrl: SOURCE_URL,
            showAdAttribution: true,
            renderLargerThumbnail: true,
          },
        },
      }, { quoted: message });

      console.log("[GALAXY-MD] Mention audio sent successfully.");
      return true;
    } catch (error) {
      console.error("[GALAXY-MD] Mention audio plugin failed:", error.stack || error);
      return false;
    }
  },
};
