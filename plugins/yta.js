"use strict";

const yt = require("../lib/yt");

module.exports = {
  name: "yta",
  aliases: ["audio"],
  description: "Download YouTube audio as MP3 (link or song name)",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    let url = yt.youtubeUrlFrom(input);

    // a link that is not YouTube is not a song name
    if (!input || (!url && /https?:\/\//i.test(input))) {
      return sock.sendMessage(
        jid,
        {
          text:
            "Please provide a YouTube link or a song name!\n" +
            "Example: .yta https://youtu.be/VIDEO_ID\n" +
            "Example: .yta faded alan walker\n" +
            "Alias: .audio <link or name>",
        },
        { quoted: message }
      );
    }

    const say = yt.statusReporter(sock, jid, message);
    try {
      if (!url) {
        await say("🔎 Searching...");
        const results = await yt.searchYoutube(input, 1);
        if (!results?.length) return await say("❌ No results found!");
        url = results[0].url || "https://www.youtube.com/watch?v=" + results[0].id;
      } else {
        await say("🎵 Fetching info...");
      }
      await yt.sendYoutubeAudio({ sock, jid, message }, url, { mp3: true, best: true, say });
    } catch (error) {
      console.error("[GALAXY-MD] .yta error:", error.message || error);
      await say(yt.failureText(error));
    }
  },
};
