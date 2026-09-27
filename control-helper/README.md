# Control helper

Lets someone in a chat-club call control your mouse and keyboard while you
share your screen. A web page can't move your real mouse (browsers block
that on purpose), so this small program does it. It only acts on input
from a person you've clicked **Allow** for.

You only need this on the computer being controlled. The person
controlling doesn't need anything extra.

## Setup (once per computer)

Needs [Node.js](https://nodejs.org/) 18 or newer.

```
cd control-helper
npm install
```

**Mac only:** the first time someone controls your Mac, macOS will ask to
let your terminal app (Terminal, iTerm, VS Code…) control the computer. Allow
it in **System Settings → Privacy & Security → Accessibility**, then restart
the helper.

## Using it

1. Start the helper and leave its window open:
   ```
   cd control-helper
   npm start
   ```
2. In a chat-club call, click 🖥️ and share your **entire screen**. Sharing a
   window or a tab won't work, because clicks are mapped onto the whole
   screen.
3. The other person clicks **🖱️ Request control** on your screen. You get an
   **Allow / Deny** prompt.
4. While they're in control, a red bar stays at the top of chat-club. To end
   it immediately, do any of these:
   - click **Stop control**
   - stop sharing your screen
   - leave the call
   - press **Ctrl+C** in the helper window

The person controlling clicks on your screen to use it, and types while it's
selected. Clicking anywhere else (like the chat box) sends their keys back
to their own computer.

## Limits

- Only your main monitor can be controlled.
- Some shortcuts get caught by the controller's own browser or OS and never
  reach you: Ctrl+W, Alt+Tab, the Windows key, Cmd+Tab, Esc while
  fullscreen, and so on.
- It only listens on `127.0.0.1`, so other computers can't reach it directly.
  It also only accepts connections from chat-club's own web pages:
  `huey23452153.github.io`, the Firebase hosting URLs, and `localhost` for
  development. If you host chat-club somewhere else, add that address:
  ```
  npm start -- --origin https://your-site.example
  ```
- Some browsers ask "allow this site to access devices on your local network?"
  the first time the page connects to the helper. Say yes, or chat-club
  can't reach it.
