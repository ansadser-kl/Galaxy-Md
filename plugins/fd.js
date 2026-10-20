"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const baileys = require("baileys");
const downloadMediaMessage = baileys.downloadMediaMessage;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeWaveform(file) {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "8000", "-"],
      { encoding: "buffer", maxBuffer: 100 * 1024 * 1024, timeout: 60000 }
    );
    const len = stdout.length - (stdout.length % 2);
    if (len < 2) return undefined;
    const ab = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + len);
    const samples = new Int16Array(ab);
    const bars = 64;
    const block = Math.max(1, Math.floor(samples.length / bars));
    const vals = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < block; j++) {
        const s = samples[i * block + j];
        if (s !== undefined) {
          sum += Math.abs(s);
          count++;
        }
      }
      vals.push(count ? sum / count : 0);
    }
    const max = Math.max(...vals, 1);
    return new Uint8Array(vals.map((v) => Math.floor((v / max) * 100)));
  } catch {
    return undefined;
  }
}

async function getDuration(file) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) ? Math.max(1, Math.round(d)) : undefined;
  } catch {
    return undefined;
  }
}

module.exports = {
  name: "fd",
  aliases: [],
  description: "Send replied audio as voice note to a JID/channel (encoding test)",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const targetJid = input.split(/\s+/)[0];
    if (!targetJid || !/^[0-9]+@(s\.whatsapp\.net|g\.us|newsletter)$/.test(targetJid)) {
      await sock.sendMessage(
        jid,
        { text: "Usage: reply to an audio and type .fd <jid>" },
        { quoted: message }
      );
      return;
    }

    const context = message?.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    const quotedMessage = quoted
      ? { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant }, message: quoted }
      : null;

    if (!quotedMessage || !(quoted.audioMessage || quoted.documentMessage?.mimetype?.startsWith("audio/"))) {
      await sock.sendMessage(
        jid,
        { text: "❌ Oru audio/voice note-inu reply cheythu .fd <jid> kodukkuka." },
        { quoted: message }
      );
      return;
    }

    const ackHandler = (node) => {
      const a = node?.attrs || {};
      console.log("[fd] ACK:", JSON.stringify(a), a.error ? "<-- ERROR " + a.error : "");
    };
    try { sock.ws.on("CB:ack,class:message", ackHandler); } catch {}

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-fd-"));
    try {
      await sock.sendMessage(jid, { text: "🎙️ 4 encoding test ayakkunnu..." }, { quoted: message });

      const audioBuffer = await downloadMediaMessage(
        quotedMessage,
        "buffer",
        {},
        { logger: console, reuploadRequest: sock.updateMediaMessage }
      );
      if (!audioBuffer || !audioBuffer.length) throw new Error("Audio download failed");

      const inputFile = path.join(tempDir, "input-audio");
      fs.writeFileSync(inputFile, audioBuffer);

      // 4 encoding variant
      const encodings = [
        [
          "1 current 48k/48kHz vbr-off",
          ["-b:a", "48k", "-vbr", "off", "-compression_level", "10", "-frame_duration", "20", "-application", "audio", "-ar", "48000"],
          true,
        ],
        [
          "2 whatsapp-native 16kHz 24k voip",
          ["-b:a", "24k", "-vbr", "on", "-application", "voip", "-ar", "16000"],
          true,
        ],
        [
          "3 common-bot-recipe 128k vbr-on",
          ["-b:a", "128k", "-vbr", "on", "-compression_level", "10", "-ar", "48000"],
          true,
        ],
        [
          "4 recipe-3 but no waveform/seconds",
          ["-b:a", "128k", "-vbr", "on", "-compression_level", "10", "-ar", "48000"],
          false,
        ],
      ];

      let anyOk = false;
      for (let i = 0; i < encodings.length; i++) {
        const [label, opts, withMeta] = encodings[i];
        const out = path.join(tempDir, `v${i + 1}.ogg`);
        try {
          await execFileAsync(
            "ffmpeg",
            ["-y", "-i", inputFile, "-vn", "-map_metadata", "-1", "-c:a", "libopus", ...opts, "-ac", "1", "-f", "ogg", out],
            { timeout: 180000 }
          );
          const buf = fs.readFileSync(out);
          const payload = { audio: buf, mimetype: "audio/ogg; codecs=opus", ptt: true };
          if (withMeta) {
            const seconds = await getDuration(out);
            const waveform = await makeWaveform(out);
            if (seconds) payload.seconds = seconds;
            if (waveform) payload.waveform = waveform;
          }
          await sock.sendMessage(targetJid, { text: "TEST " + label });
          const res = await sock.sendMessage(targetJid, payload);
          console.log(`[fd] ${label}: sent id=${res?.key?.id}, size=${(buf.length / 1024).toFixed(1)} KB`);
          anyOk = true;
        } catch (e) {
          console.error(`[fd] ${label} FAIL:`, e?.message || e);
        }
        await sleep(3000);
      }

      if (!anyOk) throw new Error("Ellaa variant-um fail aayi (console log nokku)");

      await sock.sendMessage(
        jid,
        { text: "✅ 4 variant ayachu. Normal WhatsApp-il ethu play aakunnu ennu nokku." },
        { quoted: message }
      );
    } catch (error) {
      console.error("[GALAXY-MD] .fd failed:", error);
      await sock.sendMessage(
        jid,
        { text: "❌ Failed: " + String(error?.message || error).slice(0, 180) },
        { quoted: message }
      );
    } finally {
      try { sock.ws.off("CB:ack,class:message", ackHandler); } catch {}
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  },
};
