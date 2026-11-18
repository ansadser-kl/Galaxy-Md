"use strict";

const { getArgs, runEffect } = require("./fx-core");

module.exports = {
  name: "slow",
  aliases: [],
  description: "Slow audio: .slow [0.5-0.99]",
  category: "Tools",

  async execute({ sock, jid, message, text, args }) {
    const values = getArgs(text, args);
    const rate = values[0] === undefined ? 0.8 : Number(values[0]);

    if (!Number.isFinite(rate) || rate < 0.5 || rate >= 1) {
      return sock.sendMessage(jid, {
        text: "Usage: .slow [0.5-0.99]\nExample: .slow 0.8\nAudio/voice/video-kku reply cheythu ayakkuka."
      }, { quoted: message });
    }

    await runEffect({
      sock, jid, message, name: "slow",
      usage: ".slow ayakkuka.",
      values,
      buildArgs: (v, inFile, outFile) => [
        "-y", "-i", inFile, "-vn",
        "-af", "atempo=" + rate,
        "-c:a", "libmp3lame", "-b:a", "192k", outFile
      ]
    });
  }
};
