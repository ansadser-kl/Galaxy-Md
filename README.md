# GALAXY-MD V2.0 🚀

A WhatsApp bot with a **Gemini AI agent**, using **Baileys 7.0.0-rc14** and **CommonJS plugin files**, for Android Termux, VPS/cloud hosting, and PC/laptop.

## Features

- Pairing-code login only — no QR code flow.
- Reads the WhatsApp number from `.env` using `BOT_NUMBER`.
- Saves WhatsApp auth data in `session/` and reuses it after restarts.
- Automatic reconnect after temporary disconnects.
- Commands loaded from individual `.js` files in `plugins/`.
- Utility and group commands depend on the plugins present in this repository.
- Access control: `.mode public` allows everyone to use commands; `.mode private` restricts commands to the configured bot number and `SUDO` numbers.

## V2.0 AI agent

- Default model: `gemini-3.5-flash-lite`. You can set `GEMINI_MODEL` to another currently supported model.
- Language behavior: Malayalam, Manglish, English, and Hindi; AI is instructed to match the sender's language or explicit language request.
- Direct messages: AI responds to readable text messages from any sender.
- Groups: AI responds only when the bot account itself is an admin in that group.
- AI can select existing plugins by their exported name/alias; normal dot commands continue to work.
- Group moderation actions are permission-gated in the AI layer. Review plugins before installing or enabling them.
- Generic link auto-download excludes YouTube links.
- API requests try the configured Gemini keys in order. If a key is rate-limited, quota-exhausted, or invalid, the agent tries the next configured key. Other errors do not automatically burn through every key.
- Multiple keys do not guarantee combined quotas; Google may apply limits by project, account, or model.

## Configure

Install dependencies and create your private environment file:

```bash
npm install
cp .env.example .env
```

Set the real WhatsApp number and Gemini API keys in `.env`:

```env
BOT_NUMBER="919876543210"
OWNER_NUMBER="919876543210"
SUDO="919111111111,919222222222"
MODE="public"
GEMINI_API_KEY_1="your_first_key"
GEMINI_API_KEY_2="your_second_key"
GEMINI_API_KEY_3="your_third_key"
GEMINI_API_KEY_4="your_fourth_key"
GEMINI_MODEL="gemini-3.5-flash-lite"
```

Keys are optional individually; one configured key is enough. The legacy `GEMINI_API_KEY` is also supported. Never paste real API keys into source code or commit the `.env` file.

Start the bot:

```bash
npm start
```

The pairing code is requested only if the saved session is not registered. After linking WhatsApp, keep the `session/` folder in place.

## Plugin interface

Create a `.js` file inside `plugins/`. A plugin should export an object with a unique `name`, optional `aliases`, optional `description`, and an async `execute` function that accepts the bot context.

```js
"use strict";

module.exports = {
  name: "hello",
  aliases: ["hi"],
  description: "Say hello",
  async execute({ sock, jid, message, query }) {
    await sock.sendMessage(
      jid,
      { text: query ? `Hello, ${query}!` : "Hello!" },
      { quoted: message }
    );
  },
};
```

## Privacy and deployment notes

- Keep `.env`, `session/`, and any private credentials out of GitHub.
- `.env.example` contains placeholders only.
- To restrict access to the AI source file, make the repository private and allow only the two intended GitHub accounts. A file inside a public repository cannot be made private by itself; JavaScript obfuscation is not a security boundary.
- Run only one live bot instance using the same WhatsApp session at a time.
- Gemini API usage may be subject to quotas, rate limits, billing, and Google's terms.
