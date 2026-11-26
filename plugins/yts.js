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

function findPlugin(plugins, names) {
  return (plugins || []).find((plugin) => {
    const values = [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])]
      .map((value) => String(value || "").toLowerCase());
    return values.some((value) => names.includes(value));
  });
}

module.exports = {
  name: "yts",
  aliases: ["ytsearch"],
  description: "Search YouTube and download a selected result as audio or video",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const query = String(text || args?.join(" ") || "").trim();
    if (!query) {
      return sock.sendMessage(
        jid,
        { text: "🔎 *YouTube Search*\nExample: .yts Delulu\n\nType the song or video name to search." },
        { quoted: message }
      );
    }

    const key = choiceKey(jid, message);
    pendingChoices.delete(key);

    const say = yt.statusReporter(sock, jid, message);
    try {
      await say("🔎 Searching YouTube: " + yt.cleanText(query, 100));
      const found = await yt.searchYoutube(query, 10);
      const results = (found || [])
        .map((video) => ({
          ...video,
          url: yt.youtubeUrlFrom(video.url) || (video.id ? "https://www.youtube.com/watch?v=" + video.id : null),
        }))
        .filter((video) => video.url)
        .slice(0, 10);

      if (!results.length) return await say("❌ No results found. Try another name.");

      prune();
      pendingChoices.set(key, { stage: "select", results, query, createdAt: Date.now() });

      const lines = results.map((video, index) =>
        "*" + (index + 1) + ".* " + (yt.cleanText(video.title, 140) || "Untitled") + "\n" +
        "   _Duration:_ `" + (yt.cleanText(video.duration, 20) || "Unknown") + "` | _Views:_ `" + yt.formatViews(video.views) + "`\n" +
        "   _Channel:_ " + (yt.cleanText(video.channel?.name, 80) || "Unknown channel")
      );

      await sock.sendMessage(
        jid,
        {
          text:
            "*YouTube Search Results*\n\n" +
            "_Found " + results.length + " results for:_ *" + yt.cleanText(query, 100) + "*\n\n" +
            lines.join("\n\n") +
            "\n\n_Reply with a number (1-" + results.length + ") to see video details._" +
            "\n\n_Selection expires in 10 minutes._",
        },
        { quoted: message }
      );
      await say("✅ Search complete.");
    } catch (error) {
      console.error("[GALAXY-MD] .yts search error:", error.message || error);
      const reason = yt.failureText(error);
      await say(reason === "❌ Download failed!" ? "❌ YouTube search failed! Try again later." : reason);
    }
  },

  async handleReply({ sock, jid, message, text, plugins }) {
    const key = choiceKey(jid, message);
    const pending = pendingChoices.get(key);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > CHOICE_TTL) {
      pendingChoices.delete(key);
      await sock.sendMessage(jid, { text: "⌛ Selection expired. Please use .yts again." }, { quoted: message });
      return true;
    }

    const reply = String(text || "").trim();

    if (pending.stage === "select") {
      if (!/^\d+$/.test(reply)) return false;

      const index = Number(reply) - 1;
      if (index < 0 || index >= pending.results.length) {
        await sock.sendMessage(
          jid,
          { text: "❌ Invalid number. Reply with a number from 1 to " + pending.results.length + "." },
          { quoted: message }
        );
        return true;
      }

      const selected = pending.results[index];
      pending.stage = "format";
      pending.selected = selected;
      pending.createdAt = Date.now();
      pendingChoices.set(key, pending);

      const caption =
        "🎬 *" + (yt.cleanText(selected.title) || "YouTube video") + "*\n" +
        "👤 " + (yt.cleanText(selected.channel?.name, 100) || "Unknown channel") + "\n" +
        "⏱ " + (yt.cleanText(selected.duration, 20) || "Unknown") + "\n\n" +
        "Which format do you want? Reply:\n" +
        "1️⃣ *audio* — MP3\n" +
        "2️⃣ *video* — MP4\n\n" +
        "Reply: audio / video (or 1 / 2).";

      const thumbnail = /^https:\/\//i.test(selected.thumbnail || "")
        ? selected.thumbnail
        : selected.id ? "https://i.ytimg.com/vi/" + selected.id + "/hqdefault.jpg" : null;

      try {
        if (thumbnail) await sock.sendMessage(jid, { image: { url: thumbnail }, caption }, { quoted: message });
        else await sock.sendMessage(jid, { text: caption }, { quoted: message });
      } catch {
        await sock.sendMessage(jid, { text: caption }, { quoted: message });
      }
      return true;
    }

    if (pending.stage === "format") {
      const format = reply.toLowerCase();
      if (!["audio", "video", "1", "2", "mp3", "mp4"].includes(format)) {
        await sock.sendMessage(jid, { text: "Select a format: *audio* / *video* (or 1 / 2)." }, { quoted: message });
        return true;
      }

      const selected = pending.selected;
      pendingChoices.delete(key);
      const isAudio = ["audio", "1", "mp3"].includes(format);
      const plugin = findPlugin(plugins, isAudio ? ["yta", "audio"] : ["ytv", "video"]);

      if (!plugin || typeof plugin.execute !== "function") {
        await sock.sendMessage(
          jid,
          { text: isAudio ? "❌ Audio downloader plugin (.yta) not found." : "❌ Video downloader plugin (.ytv) not found." },
          { quoted: message }
        );
        return true;
      }

      try {
        await plugin.execute({
          sock,
          jid,
          message,
          text: selected.url,
          args: [selected.url],
          config: {},
          plugins,
        });
      } catch (error) {
        console.error("[GALAXY-MD] .yts selected download error:", error?.message || error);
        await sock.sendMessage(jid, { text: "❌ Download failed!" }, { quoted: message });
      }
      return true;
    }

    return false;
  },
};
