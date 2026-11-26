"use strict";

const yt = require("../lib/yt");

module.exports = {
  name: "play",
  aliases: ["song"],
  description: "Search YouTube and send the song as an audio file",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();

    if (!input) {
      return sock.sendMessage(
        jid,
        { text: "*Play / Song*\n\nEnter a song name or a YouTube link.\nExample: .play Varnajaalam\nAlias: .song Varnajaalam" },
        { quoted: message }
      );
    }

    const say = yt.statusReporter(sock, jid, message);
    try {
      let url = yt.youtubeUrlFrom(input);
      if (!url) {
        if (/https?:\/\//i.test(input)) return await say("❌ That is not a valid YouTube link.");
        await say("🔎 Searching...");
        const results = await yt.searchYoutube(input, 1);
        if (!results?.length) return await say("❌ No results found!");
        url = results[0].url || "https://www.youtube.com/watch?v=" + results[0].id;
        await say("⬇️ Downloading *" + yt.cleanText(results[0].title, 120) + "*...");
      }
      await yt.sendYoutubeAudio({ sock, jid, message }, url, { say });
    } catch (error) {
      console.error("[GALAXY-MD] .play error:", error.message || error);
      await say(yt.failureText(error));
    }
  },
};
