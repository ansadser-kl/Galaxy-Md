"use strict";

module.exports = {
  botName: "GALAXY-MD",
  prefix: ".",
  version: "1.0.0",
  // WhatsApp number with country code, digits only; loaded from .env.
  botNumber: process.env.BOT_NUMBER || "",
  ownerNumber: process.env.OWNER_NUMBER || process.env.BOT_NUMBER || "",
};
