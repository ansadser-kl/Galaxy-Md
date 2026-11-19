"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CDN_UPLOAD = "https://cdnfile.pages.dev/temp";
const UPSCALE_V1 = "https://jerrycoder.oggyapi.workers.dev/tool/upscale-v1";
const UPSCALE_V2 = "https://jerrycoder.oggyapi.workers.dev/tool/upscale-v2";
const MAX_INPUT = 15 * 1024 * 1024;
const MEDIA_TYPES = ["imageMessage", "documentMessage"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unwrap(m) {
  let cur = m || {};
  for (let i = 0; i < 6; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.documentWithCaptionMessage?.message;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// Image-ilekku reply allenkil image-um caption-um aayi ayachathu
function getImageSource(message) {
  const own = unwrap(message?.message);
  const ctx =
    own?.extendedTextMessage?.contextInfo ||
    own?.imageMessage?.contextInfo ||
    own?.documentMessage?.contextInfo;
  const quoted = unwrap(ctx?.quotedMessage);

  const pick = (m) => {
    if (m?.imageMessage) return "imageMessage";
    if (m?.documentMessage && /^image\//i.test(m.documentMessage.mimetype || "")) return "documentMessage";
    return null;
  };

  if (quoted && pick(quoted)) {
    return {
      msg: {
        key: { remoteJid: message.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
        message: quoted,
      },
    };
  }
  if (own && pick(own)) return { msg: message };
  return null;
}

function loadDownloader() {
  for (const name of ["baileys", "@whiskeysockets/baileys"]) {
    try {
      const mod = require(name);
      if (typeof mod.downloadMediaMessage === "function") return mod.downloadMediaMessage;
    } catch {}
  }
  throw new Error("Baileys downloadMediaMessage not found.");
}

// Image CDN-il upload cheyyum, public URL thirichu tharum
async function uploadToCdn(buffer, name) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/jpeg" }), name);
  const res = await fetch(CDN_UPLOAD, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("CDN upload HTTP " + res.status);
  const data = await res.json().catch(() => null);
  const url = data?.url || data?.data;
  if (!url) throw new Error("CDN upload invalid response");
  return url;
}

async function upscaleV1(imageUrl, resolution) {
  const res = await fetch(
    `${UPSCALE_V1}?img=${encodeURIComponent(imageUrl)}&resolution=${resolution}`,
    { signal: AbortSignal.timeout(60000) }
  );
  if (!res.ok) throw new Error("Server 1 HTTP " + res.status);
  const data = await res.json();
  if (!data?.result_url) throw new Error("Server 1 invalid response");
  return data.result_url;
}

async function upscaleV2(imageUrl) {
  const res = await fetch(`${UPSCALE_V2}?image=${encodeURIComponent(imageUrl)}`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error("Server 2 HTTP " + res.status);
  const data = await res.json();
  if (!data?.url) throw new Error("Server 2 invalid response");
  return data.url;
}

module.exports = {
  name: "upscale",
  aliases: ["hd"],
  description: "Upscale an image with AI. Reply to an image: .upscale [2-6] or .upscale <image-url>",
  category: "Tools",

  async execute({ sock, jid, message, text, args }) {
    const send = (t) => sock.sendMessage(jid, { text: t }, { quoted: message });

    const input = String(text || args?.join(" ") || "").trim();
    const words = input.split(/\s+/).filter(Boolean).slice(1);

    let resolution = 2;
    const resWord = words.find((w) => /^[2-6]$/.test(w));
    if (resWord) resolution = Number(resWord);

    const urlMatch = input.match(/https?:\/\/\S+/i);
    const directUrl = urlMatch ? urlMatch[0] : null;

    const source = directUrl ? null : getImageSource(message);
    if (!directUrl && !source) {
      return send("_Image-il reply cheythu .upscale ayakkuka, allenkil .upscale <image-url>_\nExample: .upscale 4");
    }

    let statusMessage;
    const editStatus = async (t) => {
      try {
        if (statusMessage?.key) await sock.sendMessage(jid, { text: t, edit: statusMessage.key });
      } catch {}
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "_Upscaling image... please wait..._" }, { quoted: message });

      let imageUrl = directUrl;
      if (!imageUrl) {
        const downloadMediaMessage = loadDownloader();
        const buffer = await downloadMediaMessage(source.msg, "buffer", {});
        if (!buffer?.length) throw new Error("Could not download the image.");
        if (buffer.length > MAX_INPUT) throw new Error("Image too large (max 15 MB).");

        await editStatus("_Uploading image to CDN..._");
        imageUrl = await uploadToCdn(buffer, "upscale-" + Date.now() + ".jpg");
        await editStatus("_Image uploaded 📥_\n\n_Upscaling image..._");
      }

      let resultUrl;
      let usedServer;
      try {
        resultUrl = await upscaleV1(imageUrl, resolution);
        usedServer = "Server 1";
      } catch (e) {
        console.warn("[GALAXY-MD] upscale server 1 failed:", e?.message);
        await sleep(500);
        resultUrl = await upscaleV2(imageUrl);
        usedServer = "Server 2";
      }

      await sock.sendMessage(
        jid,
        {
          image: { url: resultUrl },
          caption: `*Upscaled Successfully ✅*\n\n🎚️ Resolution: ${resolution}x\n⚡ Server: ${usedServer}`,
        },
        { quoted: message }
      );

      await editStatus("_Done ✅_");
    } catch (error) {
      console.error("[GALAXY-MD] Upscale failed:", error?.message || error);
      await editStatus("_Upscaling failed:_ " + String(error?.message || error).slice(0, 200));
    }
  },
};
