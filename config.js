"use strict";

const fs = require("fs");
const path = require("path");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8")); }
  catch { return {}; }
}
const savedMode = readJson("mode.json").mode;
const data = readJson("galaxy-data.json");
const sudoNumbers = [
  ...String(process.env.SUDO || "").split(","),
  ...(Array.isArray(data.sudo) ? data.sudo : []),
].map((number) => String(number).replace(/\D/g, "")).filter(Boolean);

module.exports = {
  botName: String(data.botName || process.env.BOT_NAME || "GALAXY-MD"),
  prefix: String(data.prefix || process.env.PREFIX || "."),
  version: "2.0.0",
  botNumber: process.env.BOT_NUMBER || "",
  ownerNumber: String(data.ownerNumber || process.env.OWNER_NUMBER || process.env.BOT_NUMBER || ""),
  sudoNumbers: [...new Set(sudoNumbers)],
  mode: ["public", "private"].includes(String(savedMode).toLowerCase())
    ? String(savedMode).toLowerCase()
    : (String(process.env.MODE || "public").toLowerCase() === "private" ? "private" : "public"),
};
