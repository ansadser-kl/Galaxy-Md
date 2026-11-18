"use strict";

const { getArgs, runEffect } = require("./fx-core");

module.exports = {
  name: "trim",
  aliases: [],
  description: "Audio trim: .trim <start> <end>",
  category: "Tools",

  async execute({ sock, jid, message, text, args }) {
    const values = getArgs(text, args);
    const start = Number(values[0]);
    const end = Number(values[1]);

    if (values.length < 2 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      return sock.sendMessage(jid, {
        text: "Usage: .trim <start_sec> <end_sec>\nExample: .trim 10 40\nAudio/voice/video-kku reply cheythu ayakkuka."
      }, { quoted: message });
    }

    await runEffect({
      sock, jid, message, name: "trim",
      usage: ".trim <start> <end> ayakkuka.",
      values,
      buildArgs: (v, inFile, outFile) => [
        "-y", "-i", inFile, "-vn",
        "-ss", String(start), "-to", String(end),
        "-c:a", "libmp3lame", "-b:a", "192k", outFile
      ]
    });
  }
};
