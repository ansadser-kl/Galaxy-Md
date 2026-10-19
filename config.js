"use strict";

const fs = require("fs");
const path = require("path");

let savedMode = "";
try {
  savedMode = JSON.parse(fs.readFileSync(path.join(__dirname, "mode.json"), "utf8")).mode;
} catch {}

const sudoNumbers = String(process.env.SUDO || "")
  .split(",")
  .map((number) => number.replace(/\D/g, ""))
  .filter(Boolean);

module.exports = {
  botName: "GALAXY-MD",
  prefix: ".",
  version: "1.0.0",
  botNumber: process.env.BOT_NUMBER || "",
  ownerNumber: process.env.OWNER_NUMBER || process.env.BOT_NUMBER || "",
  sudoNumbers,
  mode: ["public", "private"].includes(String(savedMode).toLowerCase())
    ? String(savedMode).toLowerCase()
    : (String(process.env.MODE || "public").toLowerCase() === "private" ? "private" : "public"),
};
