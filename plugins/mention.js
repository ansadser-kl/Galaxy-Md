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

function unwrapMessage(message) {
  let current = message || {};
  while (current.ephemeralMessage?.message ||
         current.viewOnceMessage?.message ||
         current.viewOnceMessageV2?.message ||
         current.documentWithCaptionMessage?.message) {
    current = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.documentWithCaptionMessage?.message;
  }
  return current;
}

function getMentionContext(message) {
  const msg = unwrapMessage(message?.message);
  return msg.extendedTextMessage?.contextInfo ||
    msg.imageMessage?.contextInfo ||
    msg.videoMessage?.contextInfo ||
    msg.documentMessage?.contextInfo ||
    msg.audioMessage?.contextInfo ||
    msg.stickerMessage?.contextInfo ||
    null;
}

async function fetchBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Media fetch failed with status " + response.status);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  name: "mention",
  aliases: [],
  description: "Play a random configured audio when the bot or SUDO is mentioned",
  async execute() {},

  async handleMessage({ sock, jid, message, text, config }) {
    if (message?.key?.fromMe) return false;

    const sudoNumbers = (config.sudoNumbers || [])
      .map(digits)
      .filter(Boolean);
    const botNumber = digits(config.botNumber);
    if (botNumber) sudoNumbers.push(botNumber);

    const targets = [...new Set(sudoNumbers)];
    if (!targets.length) return false;

    const context = getMentionContext(message);
    const mentionedJids = (context?.mentionedJid || []).map((value) => String(value || "").toLowerCase());
    const mentionedNumbers = mentionedJids.map(digits).filter(Boolean);
    const botJids = [sock.user?.id, sock.user?.lid]
      .map((value) => String(value || "").toLowerCase().replace(/:\\d+(?=@)/, ""))
      .filter(Boolean);
    const directBotMention = mentionedJids.some((jid) => botJids.includes(jid));
    const textMatches = targets.some((number) =>
      String(text || "").includes("@" + number)
    );
    const jidMatches = targets.some((number) =>
      mentionedNumbers.some((mentioned) =>
        mentioned === number || mentioned.endsWith(number) || number.endsWith(mentioned)
      )
    );

    if (!textMatches && !jidMatches && !directBotMention) return false;

    try {
      const audioUrl = AUDIOS[Math.floor(Math.random() * AUDIOS.length)];
      const imageUrl = IMAGES[Math.floor(Math.random() * IMAGES.length)];
      const [audio, thumbnail] = await Promise.all([
        fetchBuffer(audioUrl),
        fetchBuffer(imageUrl).catch(() => null),
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
      return true;
    } catch (error) {
      console.error("[GALAXY-MD] Mention audio plugin failed:", error.message || error);
      return false;
    }
  },
};
