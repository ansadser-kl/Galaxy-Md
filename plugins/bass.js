"use strict";

const { getArgs, runEffect } = require("./fx-core");

module.exports = {
  name: "bass",
  aliases: [],
  description: "Bass boost: .bass [1-30]",
  category: "Tools",

  async execute({ sock, jid, message, text, args }) {
    const values = getArgs(text, args);
    const gain = values[0] === undefined ? 10 : Number(values[0]);

    if (!Number.isFinite(gain) || gain < 1 || gain > 30) {
      return sock.sendMessage(jid, {
        text: "Usage: .bass [1-30]\nExample: .bass 12\nAudio/voice/video-kku reply cheythu ayakkuka."
      }, { quoted: message });
    }

    await runEffect({
      sock, jid, message, name: "bass",
      usage: ".bass ayakkuka.",
      values,
      buildArgs: (v, inFile, outFile) => [
        "-y", "-i", inFile, "-vn",
        "-af", "bass=g=" + gain,
        "-c:a", "libmp3lame", "-b:a", "192k", outFile
      ]
    });
  }
};
