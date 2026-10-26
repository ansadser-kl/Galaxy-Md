"use strict";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const QUOTA_ERROR = /resource_exhausted|quota|rate.?limit|too many requests|http 429|429|daily limit|requests per minute|tokens per minute/i;
const INVALID_KEY_ERROR = /api key not valid|invalid api key|api_key_invalid|key expired|http 401/i;

function messageText(result) {
  return result?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

function cleanJson(value) {
  let text = String(value || "").trim();
  text = text.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

function normalNumber(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isTrusted({ message, config }) {
  const sender = message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid || "";
  const number = normalNumber(sender);
  const allowed = [config.botNumber, config.ownerNumber, ...(config.sudoNumbers || [])].map(normalNumber).filter(Boolean);
  return allowed.some((item) => number && number === item);
}

function pluginNames(plugin) {
  return [plugin.name, ...(Array.isArray(plugin.aliases) ? plugin.aliases : [])].join(" ");
}

function needsGroupAdmin(plugin) {
  return /(^|[^a-z])(kick|ban|promote|demote|tagall|delete|purge|antilink|leave|block|unblock)([^a-z]|$)/i.test(pluginNames(plugin));
}

function needsOwner(plugin) {
  return /(^|[^a-z])(mode|sudo|restart|logout|eval|shell|exec|broadcast|owneronly)([^a-z]|$)/i.test(pluginNames(plugin));
}

function toolList(plugins) {
  return plugins.map((plugin) => ({
    name: plugin.name,
    aliases: Array.isArray(plugin.aliases) ? plugin.aliases : [],
    description: String(plugin.description || plugin.help || ("Run the " + plugin.name + " plugin.")).slice(0, 240),
  }));
}

function getApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY,
  ].map((key) => String(key || "").trim()).filter(Boolean);
  return [...new Set(keys)];
}

function isKeyOrQuotaFailure(error) {
  return QUOTA_ERROR.test(String(error?.message || error)) || INVALID_KEY_ERROR.test(String(error?.message || error));
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
    "If a URL is present, select a plugin that supports that platform if one exists. Never select a YouTube downloader unless the user clearly asks for a YouTube download and a matching plugin is listed. If no tool supports the request, explain that briefly.",
    "For ordinary questions, chat, translation, coding help, and general knowledge, reply only in the language used or explicitly requested by the user. Supported languages: Malayalam (മലയാളം script), Manglish (Malayalam written in Latin letters), English, and Hindi (हिन्दी script). Match the user's current message language; do not randomly switch languages.",
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
    const detail = data?.error?.message || ("HTTP " + response.status);
    const error = new Error(detail);
    error.status = response.status;
    error.apiStatus = data?.error?.status || "";
    throw error;
  }
  return cleanJson(messageText(data));
}

async function askWithKeyRotation({ apiKeys, model, text, plugins, isGroup, botIsAdmin }) {
  let lastError;
  for (let index = 0; index < apiKeys.length; index += 1) {
    try {
      return await askGemini({ apiKey: apiKeys[index], model, text, plugins, isGroup, botIsAdmin });
    } catch (error) {
      lastError = error;
      const eligible = isKeyOrQuotaFailure(error);
      const hasNext = index < apiKeys.length - 1;
      if (!eligible || !hasNext) break;
      console.warn("[GALAXY-MD AI] Key " + (index + 1) + " reached a quota/rate limit or is invalid; trying the next configured key.");
    }
  }
  throw lastError || new Error("No Gemini API key is configured.");
}

async function handleAIMessage(context) {
  const apiKeys = getApiKeys();
  if (!apiKeys.length) return false;

  const { sock, jid, message, text, config, plugins } = context;
  const isGroup = String(jid || "").endsWith("@g.us");
  if (message?.key?.fromMe) return true;
  // Fail closed: the bot must be positively identified as a group admin before any group AI reply.
  if (isGroup && !context.botIsAdmin) return true;
  if (!String(text || "").trim()) return false;

  const model = String(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
  try {
    const result = await askWithKeyRotation({
      apiKeys, model, text, plugins, isGroup, botIsAdmin: !!context.botIsAdmin,
    });

    if (result?.type === "tool") {
      const pluginName = String(result.name || "").toLowerCase();
      const plugin = plugins.find((item) =>
        item.name.toLowerCase() === pluginName ||
        (Array.isArray(item.aliases) && item.aliases.some((alias) => String(alias).toLowerCase() === pluginName))
      );
      if (!plugin) {
        await sock.sendMessage(jid, { text: "I couldn't find a matching tool for that request." }, { quoted: message });
        return true;
      }

      const trusted = isTrusted({ message, config });
      if (needsOwner(plugin) && !trusted) {
        await sock.sendMessage(jid, { text: "Ee bot-control action owner/SUDO users maathram cheyyam." }, { quoted: message });
        return true;
      }
      if (needsGroupAdmin(plugin) && isGroup && !context.senderIsAdmin && !trusted) {
        await sock.sendMessage(jid, { text: "Ee group-management action cheyyan group admin permission venam." }, { quoted: message });
        return true;
      }
      if (needsGroupAdmin(plugin) && isGroup && !context.botIsAdmin) {
        await sock.sendMessage(jid, { text: "Ee action cheyyan njan ee groupil admin aayirikkanam." }, { quoted: message });
        return true;
      }

      const argsText = String(result.args || "").trim();
      await plugin.execute({
        ...context,
        args: argsText ? argsText.split(/\s+/) : [],
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
    console.error("[GALAXY-MD AI] Request failed after configured key fallback:", error.message || error);
    return false;
  }
}

module.exports = { handleAIMessage };
