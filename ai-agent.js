"use strict";

const { getRecentHistory, saveTurn } = require("./ai-memory");

const API_URL = String(process.env.AI_API_URL || "https://api.nexray.eu.cc/ai/gemini").trim();

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
    description: String(plugin.description || plugin.help || ("Run the " + plugin.name + " plugin.")).slice(0, 180),
  }));
}

function cleanJson(value) {
  let text = String(value || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

function detectLanguage(text) {
  const value = String(text || "");
  if (/[\u0D00-\u0D7F]/.test(value)) return "Malayalam script";
  if (/[\u0900-\u097F]/.test(value)) return "Hindi";
  if (/\b(ente|njan|njaan|ningal|ninakku|entha|engane|alle|aano|aakum|venam|bro|cheyy|parayu|paranja|ithu|ith|und|illa|oru|pinne|evide|malayalam)\b/i.test(value)) return "Manglish (Malayalam written in Latin letters)";
  return "English";
}

async function askAI({ text, plugins, history, isGroup, botIsAdmin }) {
  const language = detectLanguage(text);
  const prompt = [
    "You are GALAXY-MD, a helpful WhatsApp assistant.",
    "Reply ONLY in one of these languages: Malayalam, Manglish, Hindi, or English. Never use any other language.",
    "Match the language of the CURRENT user message, not older messages. If the current message is Malayalam script, reply in Malayalam script. If it is Manglish, reply in Manglish. If Hindi, reply in Hindi. If English, reply in English. If the user switches language later, switch with them.",
    "Detected current-message language hint: " + language + ". Follow the actual current message if this hint is wrong.",
    "Use the conversation history only as context for this same chat. Do not assume details that are not in this chat's history.",
    "You can use existing plugins. If the user requests an action that exactly matches a plugin, return only JSON in this form: {\"type\":\"tool\",\"name\":\"exact_plugin_name_or_alias\",\"args\":\"arguments\"}. Do not claim an action completed before the plugin runs.",
    "For normal conversation, return only JSON in this form: {\"type\":\"reply\",\"text\":\"your response\"}. Do not wrap JSON in markdown.",
    "Never invent plugin names. Choose only from the plugin list below.",
    "Chat type: " + (isGroup ? "WhatsApp group" : "private chat") + ". Bot is group admin: " + (botIsAdmin ? "yes" : "no") + ".",
    "If this is a group, only respond when the bot is an admin. Never try to bypass that rule.",
    "Available plugins: " + JSON.stringify(toolList(plugins)),
    "Recent conversation history for this chat only:\n" + (history.length ? history.map((item) => (item.role === "assistant" ? "GALAXY-MD" : "USER") + ": " + item.content).join("\n") : "(No previous messages in this chat.)"),
    "CURRENT USER MESSAGE:\n" + String(text || ""),
  ].join("\n\n");

  const url = new URL(API_URL);
  url.searchParams.set("text", prompt);
  const response = await fetch(url.toString(), { method: "GET", signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.status === false) {
    throw new Error(data?.message || ("AI API HTTP " + response.status));
  }
  const answer = String(data?.result?.text || data?.text || "").trim();
  if (!answer) throw new Error("AI API returned an empty response.");

  try {
    return { result: cleanJson(answer), apiSessionId: String(data?.result?.session_id || "") };
  } catch {
    return { result: { type: "reply", text: answer }, apiSessionId: String(data?.result?.session_id || "") };
  }
}

async function handleAIMessage(context) {
  const { sock, jid, message, text, config, plugins } = context;
  const isGroup = String(jid || "").endsWith("@g.us");
  if (message?.key?.fromMe) return true;
  // Groups are AI-enabled only after the bot is positively confirmed as an admin.
  if (isGroup && !context.botIsAdmin) return true;
  if (!String(text || "").trim()) return false;

  try {
    const history = await getRecentHistory(jid, 12);
    const { result } = await askAI({
      text, plugins, history, isGroup, botIsAdmin: !!context.botIsAdmin,
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
      await saveTurn(jid, "user", text);
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
      const reply = result.text.trim();
      await sock.sendMessage(jid, { text: reply }, { quoted: message });
      await saveTurn(jid, "user", text);
      await saveTurn(jid, "assistant", reply);
      return true;
    }
    return false;
  } catch (error) {
    console.error("[GALAXY-MD AI] Request failed:", error.message || error);
    return false;
  }
}

module.exports = { handleAIMessage };
