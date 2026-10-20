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
  description: "Send replied audio as a voice note to a target JID / channel (test)",
  category: "Downloader",
  async execute({ sock, jid, message, text, args }) {
    const input = String(text || args?.join(" ") || "").trim();
    const targetJid = input.split(/\s+/)[0];
    if (!targetJid || !/^[0-9]+@(s\.whatsapp\.net|g\.us|newsletter)$/.test(targetJid)) {
      await sock.sendMessage(
        jid,
        { text: "Usage: reply to an audio and type .fd <jid>\nExample: .fd 120363412182028819@newsletter" },
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
      const a = node?.attrs || node;
      console.log("[fd] ACK:", JSON.stringify(a), a?.error ? "<-- ERROR " + a.error : "");
    };
    try { sock.ws.on("CB:ack,class:message", ackHandler); } catch {}

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "galaxy-fd-"));

    // oru variant ayakkunna helper
    const sendVariant = async (label, payload) => {
      try {
        await sock.sendMessage(targetJid, { text: "TEST " + label });
        const res = await sock.sendMessage(targetJid, payload);
        const m = res?.message || {};
        const media = m.audioMessage || m.imageMessage;
        console.log(`[fd] ${label} sent: id=${res?.key?.id} url=${media?.url ? "yes" : "NO"} directPath=${media?.directPath ? "yes" : "NO"}`);
        return true;
      } catch (e) {
        console.error(`[fd] ${label} FAIL:`, e?.message || e);
        return false;
      } finally {
        await sleep(3000);
      }
    };

    try {
      await sock.sendMessage(jid, { text: "🎙️ Test start cheyyunnu (image + 6 audio variant)..." }, { quoted: message });

      const audioBuffer = await downloadMediaMessage(
        quotedMessage,
        "buffer",
        {},
        { logger: console, reuploadRequest: sock.updateMediaMessage }
      );
      if (!audioBuffer || !audioBuffer.length) throw new Error("Audio download failed");

      const inputFile = path.join(tempDir, "input-audio");
      const oggFile = path.join(tempDir, "voice-note.ogg");
      const mp3File = path.join(tempDir, "audio.mp3");
      const imgFile = path.join(tempDir, "test.jpg");
      fs.writeFileSync(inputFile, audioBuffer);

      const inDuration = (await getDuration(inputFile)) || 0;
      const bitrate = inDuration > 180 ? "24k" : "48k";
      console.log(`[fd] input duration: ${inDuration}s, bitrate: ${bitrate}`);

      // ogg/opus
      await execFileAsync(
        "ffmpeg",
        [
          "-y", "-i", inputFile, "-vn", "-map_metadata", "-1",
          "-c:a", "libopus", "-b:a", bitrate, "-vbr", "off",
          "-compression_level", "10", "-frame_duration", "20",
          "-application", "audio", "-ac", "1", "-ar", "48000",
          "-f", "ogg", oggFile,
        ],
        { timeout: 180000 }
      );
      const voiceBuffer = fs.readFileSync(oggFile);
      if (!voiceBuffer.length) throw new Error("Audio conversion returned an empty file");
      console.log(`[fd] ogg size: ${(voiceBuffer.length / 1024).toFixed(1)} KB`);

      // mp3 (libmp3lame illenkil skip)
      let mp3Buffer = null;
      try {
        await execFileAsync(
          "ffmpeg",
          ["-y", "-i", inputFile, "-vn", "-c:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1", mp3File],
          { timeout: 180000 }
        );
        mp3Buffer = fs.readFileSync(mp3File);
      } catch (e) {
        console.error("[fd] mp3 convert failed (skip E):", e?.message || e);
      }

      // test image (ffmpeg thanne undakkum, file venda)
      let imgBuffer = null;
      try {
        await execFileAsync(
          "ffmpeg",
          ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1", imgFile],
          { timeout: 30000 }
        );
        imgBuffer = fs.readFileSync(imgFile);
      } catch (e) {
        console.error("[fd] test image create failed (skip image):", e?.message || e);
      }

      const seconds = await getDuration(oggFile);
      const waveform = await makeWaveform(oggFile);
      const full = { audio: voiceBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true };
      if (seconds) full.seconds = seconds;
      if (waveform) full.waveform = waveform;

      const variants = [];
      if (imgBuffer) variants.push(["IMG image", { image: imgBuffer, caption: "image test" }]);
      variants.push(["A ptt+waveform+seconds", full]);
      variants.push(["B ptt plain", { audio: voiceBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }]);
      variants.push(["C audio non-ptt", { audio: voiceBuffer, mimetype: "audio/ogg; codecs=opus" }]);
      variants.push(["D mimetype audio/ogg", { audio: voiceBuffer, mimetype: "audio/ogg", ptt: true }]);
      if (mp3Buffer) variants.push(["E mp3", { audio: mp3Buffer, mimetype: "audio/mpeg" }]);
      variants.push(["F original file", { audio: audioBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }]);

      let anyOk = false;
      for (const [label, payload] of variants) {
        const ok = await sendVariant(label, payload);
        if (ok) anyOk = true;
      }

      if (!anyOk) throw new Error("Ellaa variant-um fail aayi (console log nokku)");

      await sock.sendMessage(
        jid,
        { text: "✅ Test kazhinju. Channel-il ethu TEST-inte thazhe media vannu ennu nokku. Terminal-il 'ERROR 479' illatha ACK nokku." },
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
