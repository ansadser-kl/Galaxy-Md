"use strict";

const yt = require("../lib/yt");

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

const choiceKey = (jid, message) => jid + ":" + senderId(message, jid);

function prune() {
  const now = Date.now();
  for (const [key, value] of pendingChoices) {
    if (now - value.createdAt > CHOICE_TTL) pendingChoices.delete(key);
  }
}

module.exports = {
  name: "ytv",
  aliases: [],
  description: "Download YouTube video in selected quality",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const url = yt.youtubeUrlFrom(input);

    if (!url) {
      return sock.sendMessage(
        jid,
        { text: "Please provide a valid YouTube link!\nExample: .ytv https://youtu.be/VIDEO_ID" },
        { quoted: message }
      );
    }

    const say = yt.statusReporter(sock, jid, message);
    try {
      await say("🔎 Getting available video qualities...");
      const info = await yt.getVideoInfo(url);
      yt.assertWithinLimits(info);

      const options = yt.qualityOptions(info);
      if (!options) throw new Error("No video formats available for this video.");

      prune();
      pendingChoices.set(choiceKey(jid, message), {
        url,
        options,
        title: info.title,
        createdAt: Date.now(),
      });

      const lines = options.map((option, index) => {
        const label = option.audio ? "🎵 Audio only (MP3)" : option.quality;
        return (index + 1) + ". " + label + (option.size ? " — " + yt.formatBytes(option.size) : "");
      });
      const duration = yt.formatDuration(info.lengthSeconds);

      await say("✅ Qualities ready.");
      await sock.sendMessage(
        jid,
        {
          text:
            "🎬 *" + yt.cleanText(info.title) + "*\n" +
            "🆔 Video ID: " + info.videoId + "\n" +
            (duration ? "⏱️ Duration: " + duration + "\n" : "") +
            "\n📥 *Available qualities*\n" + lines.join("\n") + "\n\n" +
            "Reply with the number of your preferred quality.\n" +
            "⏳ Selection expires in 10 minutes.",
        },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .ytv info error:", error.message || error);
      const reason = yt.failureText(error);
      await say(reason === "❌ Download failed!" ? "❌ Failed to fetch video info. Please check the link." : reason);
    }
  },

  async handleReply({ sock, jid, message, text }) {
    const choice = String(text || "").trim();
    if (!/^\d+$/.test(choice)) return false;

    const key = choiceKey(jid, message);
    const pending = pendingChoices.get(key);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > CHOICE_TTL) {
      pendingChoices.delete(key);
      await sock.sendMessage(jid, { text: "⌛ Quality selection expired. Please use .ytv again." }, { quoted: message });
      return true;
    }

    const index = Number(choice) - 1;
    if (index < 0 || index >= pending.options.length) {
      await sock.sendMessage(
        jid,
        { text: "❌ Invalid number. Reply with a number from 1 to " + pending.options.length + "." },
        { quoted: message }
      );
      return true;
    }

    const selected = pending.options[index];
    pendingChoices.delete(key);

    const ctx = { sock, jid, message };
    if (selected.audio) await yt.sendYoutubeAudio(ctx, pending.url, { mp3: true, best: true });
    else await yt.sendYoutubeVideo(ctx, pending.url, selected.quality);
    return true;
  },
};
