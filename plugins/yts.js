"use strict";

const pendingChoices = new Map();
const CHOICE_TTL = 10 * 60 * 1000;

function senderId(message, jid) {
  return message.key?.participant || message.key?.participantAlt || jid;
}

function choiceKey(jid, message) {
  return jid + ":" + senderId(message, jid);
}

function safeText(value, max = 160) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function formatViews(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count.toLocaleString("en-US") : "N/A";
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
      return sock.sendMessage(jid, {
        text: "🔎 *YouTube Search*\nExample: .yts Delulu\n\nSearch cheyyenda song/video name type cheyyu."
      }, { quoted: message });
    }

    const key = choiceKey(jid, message);
    pendingChoices.delete(key);

    let statusMessage;
    try {
      statusMessage = await sock.sendMessage(jid, {
        text: "🔎 YouTube-il search cheyyunnu: " + safeText(query, 100)
      }, { quoted: message });

      const apiUrl = "https://xenosirapis.zone.id/api/ytsearch?query=" + encodeURIComponent(query);
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error("API error");

      const data = await response.json();
      const results = Array.isArray(data?.results)
        ? data.results.filter((item) =>
            item && typeof item.url === "string" &&
            /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(item.url)
          ).slice(0, 10)
        : [];

      if (!results.length) throw new Error("No results");

      pendingChoices.set(key, {
        stage: "select",
        results,
        query,
        createdAt: Date.now()
      });

      const lines = results.map((item, index) => {
        const title = safeText(item.title, 110) || "Untitled";
        const duration = safeText(item.duration, 12) || "Unknown";
        const author = safeText(item.author, 55) || "Unknown channel";
        return (index + 1) + ". *" + title + "*\n   ⏱ " + duration +
          " | 👁 " + formatViews(item.views) + " views\n   👤 " + author;
      });

      await sock.sendMessage(jid, {
        text: "🎵 *YouTube Search Results*\nQuery: " + safeText(query, 100) +
          "\n\n" + lines.join("\n\n") +
          "\n\nReply with the result number (1-" + results.length + ")." +
          "\n⏳ Selection expires in 10 minutes."
      }, { quoted: message });

      try {
        if (statusMessage?.key) {
          await sock.sendMessage(jid, { text: "✅ Search complete.", edit: statusMessage.key });
        }
      } catch {}
    } catch (error) {
      console.error("[GALAXY-MD] .yts search error:", error?.message || error);
      const errorText = error?.message === "No results"
        ? "❌ Search result onnum kittiyilla. Vere name try cheyyu."
        : "❌ YouTube search failed!\nAPI error";
      if (statusMessage?.key) {
        try {
          await sock.sendMessage(jid, { text: errorText, edit: statusMessage.key });
          return;
        } catch {}
      }
      await sock.sendMessage(jid, { text: errorText }, { quoted: message });
    }
  },

  async handleReply({ sock, jid, message, text, plugins }) {
    const key = choiceKey(jid, message);
    const pending = pendingChoices.get(key);
    if (!pending) return false;

    if (Date.now() - pending.createdAt > CHOICE_TTL) {
      pendingChoices.delete(key);
      await sock.sendMessage(jid, {
        text: "⌛ Selection expired. Please use .yts again."
      }, { quoted: message });
      return true;
    }

    const reply = String(text || "").trim();

    if (pending.stage === "select") {
      if (!/^\d+$/.test(reply)) return false;

      const index = Number(reply) - 1;
      if (index < 0 || index >= pending.results.length) {
        await sock.sendMessage(jid, {
          text: "❌ Invalid number. Reply with a number from 1 to " + pending.results.length + "."
        }, { quoted: message });
        return true;
      }

      const selected = pending.results[index];
      pending.stage = "format";
      pending.selected = selected;
      pending.createdAt = Date.now();
      pendingChoices.set(key, pending);

      const title = safeText(selected.title, 180) || "YouTube video";
      const caption = "🎬 *" + title + "*\n" +
        "👤 " + (safeText(selected.author, 100) || "Unknown channel") + "\n" +
        "⏱ " + (safeText(selected.duration, 20) || "Unknown") + "\n\n" +
        "Eth format venam? Reply cheyyu:\n" +
        "1️⃣ *audio* — MP3\n" +
        "2️⃣ *video* — MP4\n\n" +
        "Reply: audio / video (or 1 / 2).";

      try {
        if (typeof selected.thumbnail === "string" && /^https?:\/\//i.test(selected.thumbnail)) {
          await sock.sendMessage(jid, {
            image: { url: selected.thumbnail },
            caption
          }, { quoted: message });
        } else {
          await sock.sendMessage(jid, { text: caption }, { quoted: message });
        }
      } catch {
        await sock.sendMessage(jid, { text: caption }, { quoted: message });
      }
      return true;
    }

    if (pending.stage === "format") {
      const format = reply.toLowerCase();
      if (!["audio", "video", "1", "2", "mp3", "mp4"].includes(format)) {
        await sock.sendMessage(jid, {
          text: "Format select cheyyu: *audio* / *video* (or 1 / 2)."
        }, { quoted: message });
        return true;
      }

      const selected = pending.selected;
      pendingChoices.delete(key);
      const isAudio = ["audio", "1", "mp3"].includes(format);
      const plugin = findPlugin(plugins, isAudio ? ["yta", "audio"] : ["ytv", "video"]);

      if (!plugin || typeof plugin.execute !== "function") {
        await sock.sendMessage(jid, {
          text: isAudio
            ? "❌ Audio downloader plugin kittiyilla. .yta plugin check cheyyu."
            : "❌ Video downloader plugin kittiyilla. .ytv plugin check cheyyu."
        }, { quoted: message });
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
          plugins
        });
      } catch (error) {
        console.error("[GALAXY-MD] .yts selected download error:", error?.message || error);
        await sock.sendMessage(jid, { text: "❌ Download failed! API error" }, { quoted: message });
      }
      return true;
    }

    return false;
  }
};
