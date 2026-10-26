# GALAXY-MD V2.0 🚀

A WhatsApp bot with a **Gemini Flash AI agent**, using **Baileys 7.0.0-rc14** and **CommonJS .js files**, for Android Termux, VPS/cloud hosting, and PC/laptop.

## Features

- **Pairing-code login only** — no QR code flow
- Reads phone number from `.env` using `BOT_NUMBER`
- Saves WhatsApp auth data in `session/` and reuses it after restarts
- Automatic reconnect after temporary disconnects
- Commands loaded from individual `.js` files in `plugins/`
- Utility commands: `.ping`, `.alive`, `.menu`, `.echo`, `.owner`, `.runtime` (`.uptime` alias), `.jid`, `.mode`
- Group commands: `.groupinfo` (`.ginfo` alias), `.tagall` (admins only), `.promote` (admins only), `.demote` (admins only)\n- Access control: `.mode public` allows everyone to use commands; `.mode private` restricts commands to the configured bot number and `SUDO` numbers.

## V2.0 AI Agent

- Default model: `gemini-3.5-flash-lite` (override with `GEMINI_MODEL` if your AI Studio project supports another current model).
- Language behavior: Malayalam, Manglish, English, and Hindi; AI is instructed to match the sender's language or explicit language request.

- Configure `GEMINI_API_KEY` in `.env` to enable Gemini Flash replies and natural-language plugin selection.
- In direct messages, AI responds to readable text messages from any sender.
- In groups, AI responds only when the bot account is an admin in that group.
- AI can select existing plugins by their exported name/description; existing dot commands still work as before.
- Group moderation tools remain permission-gated. Only install plugins you trust.
- Link auto-download remains as configured in the existing core; YouTube links stay excluded from generic auto-download.
- AI calls use Google's Gemini API and may incur API usage charges. Keep the API key private.

## Install and start

```bash
git clone https://github.com/ansadser-kl/Galaxy-Md.git
cd Galaxy-Md
npm install
cp .env.example .env
```

Open `.env` and set your WhatsApp number with country code, digits only:

```env
BOT_NUMBER="919876543210"
OWNER_NUMBER="919876543210" # optional; defaults to BOT_NUMBER
SUDO="919111111111,919222222222" # optional; comma-separated trusted numbers
MODE="public" # initial mode; .mode changes are saved locally
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-3.5-flash-lite"
```

Replace the example with your own number. Do not include a plus sign or spaces. `OWNER_NUMBER` is optional and controls the contact shown by `.owner`; if omitted, `BOT_NUMBER` is used. Then run:

```bash
npm start
```

The pairing code is requested only if the saved session is not registered. After you link WhatsApp, keep the `session/` folder in place; on later restarts the bot should reuse it instead of asking for a new code.

## Adding commands/plugins

Create a `.js` file inside `plugins/`. Each plugin should export an object with a unique `name`, optional `aliases`, a `description`, and an async `execute` function.

Example:

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

The bot reloads the plugin files when processing a command, so a newly added plugin can be picked up without changing `index.js`. Commands use the `.` prefix by default.

## Important

- Keep the real `.env` file and `session/` folder private; never upload or share them.
- `.env.example` is only a template.
- Do not delete `session/` unless you intentionally want to relink the WhatsApp account.
- Run only one live bot instance using the same session at a time.
