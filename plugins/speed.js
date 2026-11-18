"use strict";

const { getArgs, runEffect } = require("./fx-core");

module.exports = {
  name: "speed",
  aliases: [],
  description: "Speed up audio: .speed [0.5-2.0]",
  category: "Tools",

  async execute({ sock, jid, message, text, args }) {
    const values = getArgs(text, args);
    const rate = values[0] === undefined ? 1.5 : Number(values[0]);

    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
      return sock.sendMessage(jid, {
        text: "Usage: .speed [0.5-2.0]\nExample: .speed 1.5\nAudio/voice/video-kku reply cheythu ayakkuka."
      }, { quoted: message });
    }

    await runEffect({
      sock, jid, message, name: "speed",
      usage: ".speed ayakkuka.",
      values,
      buildArgs: (v, inFile, outFile) => [
        "-y", "-i", inFile, "-vn",
        "-af", "atempo=" + rate,
        "-c:a", "libmp3lame", "-b:a", "192k", outFile
      ]
    });
  }
};
