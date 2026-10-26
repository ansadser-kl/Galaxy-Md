"use strict";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

function messageText(result) {
  return result?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim() || "";
}

function cleanJson(text) {
  const value = String(text || "").trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
  return JSON.parse(value);
}

function normalNumber(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isTrusted({ message, config }) {
  const sender = message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid || "";
  const number = normalNumber(sender);
  const allowed = [
    config.botNumber,
    config.ownerNumber,
    ...(config.sudoNumbers || []),
  ].map(normalNumber).filter(Boolean);
  return allowed.some((item) => number && (number === item || number.endsWith(item) || item.endsWith(number)));
}

function needsGroupAdmin(plugin) {
  const names = [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])].join(" ");
  return /(^|[^a-z])(kick|ban|promote|demote|tagall|delete|purge|antilink|mode|sudo|restart|leave|block|unblock)([^a-z]|$)/i.test(names);
}

function toolList(plugins) {
  return plugins.map((plugin) => ({
    name: plugin.name,
    aliases: Array.isArray(plugin.aliases) ? plugin.aliases : [],
    description: String(plugin.description || plugin.help || ("Run the " + plugin.name + " plugin.")).slice(0, 240),
  }));
}

async function askGemini({ apiKey, model, text, plugins, isGroup, botIsAdmin }) {
  const pluginList = toolList(plugins);
  const prompt = [
    "You are GALAXY-MD V2.0, an assistant operating inside WhatsApp.",
    "Understand the user's intent and either choose one existing plugin tool or reply normally.",
    "Return ONLY JSON with exactly one of these forms:",
    '{"type":"reply","text":"your WhatsApp reply"}',
    '{"type":"tool","name":"exact_plugin_name","args":"arguments to pass after the command"}',
    "Only choose a plugin whose exact name appears in the supplied plugin list. Never invent a plugin or claim an action succeeded unless the tool was executed.",
    "If a URL is present, select a plugin that supports that platform if one exists. Never select a YouTube downloader unless a matching plugin is listed. If no tool supports the request, explain that briefly.",
    "For ordinary questions, chat, translation, coding help, and general knowledge, reply in the user's language (Malayalam/Manglish when they use it).",
    "Do not ask for command syntax if a natural-language request can be mapped to a listed plugin.",
    "For group moderation or other privileged actions, request authorization in your reply instead of trying to bypass access controls.",
    "Context: " + (isGroup ? "WhatsApp group; bot admin status is " + (botIsAdmin ? "admin" : "not admin") + "." : "direct message."),
    "Available plugins JSON:",
    JSON.stringify(pluginList),
    "Incoming user message:",
    String(text || "(The message has no readable text.)"),
  ].join("\n\n");

  const response = await fetch(API_BASE + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(30000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || ("HTTP " + response.status);
    throw new Error("Gemini API request failed: " + message);
  }
  return cleanJson(messageText(data));
}

async function handleAIMessage(context) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return false;

  const { sock, jid, message, text, config, plugins } = context;
  const isGroup = String(jid || "").endsWith("@g.us");
  if (message?.key?.fromMe) return true;
  if (!String(text || "").trim()) return false;

  // AI is enabled in groups only while the bot account itself is a group admin.
  if (isGroup && !context.botIsAdmin) return false;

  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  try {
    const result = await askGemini({
      apiKey,
      model,
      text,
      plugins,
      isGroup,
      botIsAdmin: !!context.botIsAdmin,
    });

    if (result?.type === "tool") {
      const pluginName = String(result.name || "").toLowerCase();
      const plugin = plugins.find((item) => item.name.toLowerCase() === pluginName);
      if (!plugin) {
        await sock.sendMessage(jid, { text: "I couldn't find a matching tool for that request." }, { quoted: message });
        return true;
      }

      const trusted = isTrusted({ message, config });
      if (needsGroupAdmin(plugin) && isGroup && !context.senderIsAdmin && !trusted) {
        await sock.sendMessage(jid, { text: "Ee group-management action cheyyan group admin permission venam." }, { quoted: message });
        return true;
      }
      if (needsGroupAdmin(plugin) && isGroup && !context.botIsAdmin) {
        await sock.sendMessage(jid, { text: "Ee action cheyyan njan ee groupil admin aayirikkanam." }, { quoted: message });
        return true;
      }

      const argsText = String(result.args || "").trim();
      const args = argsText ? argsText.split(/\s+/) : [];
      await plugin.execute({
        ...context,
        args,
        query: argsText,
        text: argsText,
        command: plugin.name,
        isPrivileged: trusted,
        aiTriggered: true,
      });
      return true;
    }

    if (result?.type === "reply" && typeof result.text === "string" && result.text.trim()) {
      await sock.sendMessage(jid, { text: result.text.trim() }, { quoted: message });
      return true;
    }

    return false;
  } catch (error) {
    console.error("[GALAXY-MD AI] " + (error.message || error));
    return false;
  }
}

module.exports = { handleAIMessage };
