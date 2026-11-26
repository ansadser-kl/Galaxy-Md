"use strict";

const yt = require("../lib/yt");

module.exports = {
  name: "video",
  aliases: [],
  description: "Download a YouTube video as MP4 (360p unless a quality is given)",
  category: "Downloader",

  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const quality = input.match(/(?:^|\s)(\d{3,4}p)\s*$/i)?.[1]?.toLowerCase() || "360p";
    const url = yt.youtubeUrlFrom(input);

    if (!url) {
      return sock.sendMessage(
        jid,
        {
          text:
            "Please provide a valid YouTube link!\n" +
            "Example: .video https://youtube.com/watch?v=xxxxx\n" +
            "Example: .video https://youtu.be/xxxxx 720p\n" +
            "Shorts links work too.",
        },
        { quoted: message }
      );
    }

    await yt.sendYoutubeVideo({ sock, jid, message }, url, quality);
  },
};
