# Control helper

Lets someone in a chat-club call control your mouse and keyboard while you
share your screen. A web page can't move your real mouse (browsers block
that on purpose), so this small program does it. It only acts on input
from a person you've clicked **Allow** for.

You only need this on the computer being controlled. The person
controlling doesn't need anything extra.

## Setup (once per computer)

### Windows: one file

Double-click **`ChatClubHelper.exe`**. That's it. Nothing else to install.

Windows may show a blue "Windows protected your PC" box, because the file
isn't signed by a big company. Click **More info**, then **Run anyway**.

To remove it later, run `ChatClubHelper.exe --uninstall`.

(Building the exe: `npm install`, then `npm run build:exe`. It lands in
`dist/`, which isn't committed because it's ~70 MB.)

### Mac (or Windows without the exe)

1. Install [Node.js](https://nodejs.org/) if you don't have it (the "LTS"
   download).
2. Get this folder. On GitHub, click the green **Code** button, then
   **Download ZIP**. Unzip it and open the `control-helper` folder.
3. Double-click the installer:
   - **Windows:** `Install (Windows).bat`
   - **Mac:** `Install (Mac).command`. If macOS says it can't be opened,
     right-click it, choose **Open**, then click **Open** again.

That's it. The helper now runs quietly in the background and starts by
itself every time you log in. You never need to open it again, and you can
delete the downloaded folder afterwards.

**Mac only:** the first time someone controls your Mac, macOS asks to let
"node" control your computer. Turn it on in **System Settings → Privacy &
Security → Accessibility**. The installer opens that page for you.

## Using it

1. In a chat-club call, click 🖥️ and share your **entire screen**. Sharing a
   window or a tab won't work, because clicks are mapped onto the whole
   screen.
2. The other person clicks **🖱️ Request control** on your screen. You get an
   **Allow / Deny** prompt, and nothing happens unless you click Allow.
3. While they're in control, a red bar stays at the top of chat-club. To end
   it immediately, do any of these:
   - click **Stop control**
   - stop sharing your screen
   - leave the call

The person controlling clicks on your screen to use it, and types while it's
selected. Clicking anywhere else (like the chat box) sends their keys back
to their own computer.

## Removing it

Double-click `Uninstall (Windows).bat` or `Uninstall (Mac).command`.

## Limits

- Only your main monitor can be controlled.
- Some shortcuts get caught by the controller's own browser or OS and never
  reach you: Ctrl+W, Alt+Tab, the Windows key, Cmd+Tab, Esc while
  fullscreen, and so on.
- It only listens on `127.0.0.1`, so other computers can't reach it directly.
  It also only accepts connections from chat-club's own web pages:
  `chat-club-one.vercel.app`, `huey23452153.github.io`, the Firebase hosting
  URLs, and `localhost` for development. If chat-club moves somewhere else,
  that address has to be added in `server.js`.
- Some browsers ask "allow this site to access devices on your local network?"
  the first time the page connects to the helper. Say yes, or chat-club
  can't reach it.

## For developers

Run it in a terminal instead (it stops when you close the window):

```
npm install
npm start
```
