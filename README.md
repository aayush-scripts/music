# 🎧 MusicRoom

A tiny, private listening room for you and one friend. Paste YouTube links to
build a shared playlist, play/pause/skip, and see cover art instead of video.
Only people who know your room code can get in.

## How it works

- **Access**: one shared secret code (you pick it) — not a public app, not a
  multi-user platform, just a door only you two have the key to.
- **Playback**: uses YouTube's official IFrame Player API for audio, but the
  video element is hidden off-screen — you only ever see cover art, title, and
  your own custom controls.
- **Playlist**: stored in **Firebase Firestore**, a real cloud database - not
  a file on whatever machine happens to run the server. It stays there
  permanently regardless of restarts, redeploys, or which host you use.
  Adding/removing songs updates instantly for both of you (via Socket.io).
- **Adding songs**: paste any YouTube link (video, `youtu.be`, or Shorts link).
  The server looks up the title/thumbnail via YouTube's free oEmbed endpoint —
  no API key required for this.
- **Optional search**: if you add a `YOUTUBE_API_KEY`, you get a real search box
  instead of only pasting links (not wired into the UI yet — see "Extending"
  below if you want it, the backend endpoint `/api/search` is already there).

## File structure

```
musicroom/
├── server.js              # Express + Socket.io backend (the "API")
├── package.json
├── .env.example            # copy to .env and edit
└── public/
    ├── index.html           # markup
    ├── css/style.css        # theme/styling
    └── js/
        ├── player.js        # YouTube IFrame API wrapper
        └── app.js           # UI logic, playlist, sockets
```

## Step 1: create your free online database (Firebase Firestore)

This is what makes the playlist "save online" instead of living on one
computer. Takes about 2 minutes, no credit card needed.

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and sign in with any Google account.
2. Click **Add project** → give it any name (e.g. "musicroom") → you can
   disable Google Analytics for this, it's not needed → **Create project**.
3. In the left sidebar, go to **Build → Firestore Database** → **Create
   database** → pick any region close to you → start in **production mode**
   (default rules are fine, since only your server talks to it, not the
   browser directly).
4. Click the ⚙️ gear icon (top left, next to "Project Overview") → **Project
   settings** → **Service accounts** tab → **Generate new private key** →
   confirm. This downloads a `.json` file — keep it secret, it's the key to
   your database.
5. Open that downloaded file, copy its *entire* contents, and paste it as one
   line into your `.env` file (see Step 2) as `FIREBASE_SERVICE_ACCOUNT`.

That's it — Firestore is now your online playlist storage, completely
separate from wherever you run the actual server.

## Step 2: run the app

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. In this folder, install dependencies:
   ```
   npm install
   ```
3. Copy the environment file:
   ```
   cp .env.example .env
   ```
   Then edit `.env`:
   ```
   ROOM_CODE=whatever-you-both-agree-on
   PORT=3000
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ... }
   ```
   (paste the whole JSON file from Step 1 as one line for `FIREBASE_SERVICE_ACCOUNT`)
4. Start the server:
   ```
   npm start
   ```
5. Open `http://localhost:3000` — enter your name and the room code.

Send your friend the same URL (once deployed, see below) plus the room code.
That's the whole "invite" system — no accounts, no sign-up. The playlist both
of you see is now read from Firestore, so it's identical and permanent no
matter which of you added a song or where the server is running.

## Deploying so your friend can access it remotely

Right now this only runs on your own machine. To actually share it with your
friend over the internet, deploy it somewhere that runs Node.js, for example:

- **Render.com** (free tier): New → Web Service → connect your repo (or
  upload the folder) → Build command `npm install` → Start command
  `npm start` → add `ROOM_CODE`, `FIREBASE_SERVICE_ACCOUNT` (and optionally
  `YOUTUBE_API_KEY`) as environment variables in their dashboard.
- **Railway.app**: same flow — new project from repo, add the same env vars,
  deploy.
- **Fly.io / a small VPS**: works too, just make sure Node 18+ is available
  and `npm start` is your run command.

Because the playlist now lives in Firestore rather than on disk, it doesn't
matter which host you pick, or if the host wipes its filesystem on every
redeploy (common on free tiers) — your songs are safe either way.

Whichever you choose, put the code in a **private** GitHub repo (or just
upload the zip directly to the host) since it contains secrets in `.env`
— never commit `.env` itself, only `.env.example`. When pasting
`FIREBASE_SERVICE_ACCOUNT` into a host's dashboard, paste it as the raw JSON
string exactly as it is in your `.env` file.

Once deployed, you'll get a public URL like `https://musicroom-yourname.up.railway.app`.
Share that link + your room code with your friend, and you're both in.

## Notes & limits

- The playlist is shared globally by this app instance (there's only one
  "room" — fine since it's just for the two of you). If you ever wanted more
  friends in separate rooms, you'd need to add per-room codes and store
  playlists keyed by room ID.
- Playback itself isn't forced to stay in sync second-by-second between you
  two (that needs more complex buffering/drift handling). What *is* synced:
  the playlist (instant for both) and a small "🎧 [name] is listening to…"
  banner so you can see what the other person's playing.
- This uses YouTube's IFrame Player API within YouTube's terms — it's audio
  playback of an unmodified YouTube video, just with the visual player hidden
  and your own cover-art UI shown instead.

## Extending ideas

- Wire up `/api/search` (already built server-side) to a search box in the UI
  so you can find songs by name, not just paste links.
- Add drag-to-reorder on the playlist.
- Add a "synced listening" mode using the current track + timestamp broadcast
  over the existing socket connection.
