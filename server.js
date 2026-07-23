require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROOM_CODE = process.env.ROOM_CODE || 'change-this-secret-code';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

// ---------- Firebase Firestore (the real online database) ----------
// FIREBASE_SERVICE_ACCOUNT should be the *entire contents* of the service
// account JSON file, pasted as a single-line string, set as an env var.
// See README.md for how to get this from the Firebase console.
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT in .env - see README.md for setup steps.');
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const playlistCollection = db.collection('playlist');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- In-memory session tokens (single shared room, just two people) ----------
const validTokens = new Set();

function requireAuth(req, res, next) {
  const token = req.headers['x-room-token'];
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: 'Not authorized. Please join with the room code.' });
  }
  next();
}

// ---------- Playlist persistence helpers (Firestore) ----------
async function readPlaylist() {
  const snapshot = await playlistCollection.orderBy('addedAt', 'asc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function addTrackToDb(track) {
  // Use our own generated id as the Firestore document id, so client-side
  // ids and DB ids always match.
  await playlistCollection.doc(track.id).set(track);
}

async function removeTrackFromDb(id) {
  await playlistCollection.doc(id).delete();
}

// ---------- Helpers ----------
function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  // Already a bare 11-char video id
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '') || null;
    }
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2];
      if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2];
    }
  } catch (e) {
    // not a valid URL
  }
  return null;
}

async function fetchOEmbed(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    'https://www.youtube.com/watch?v=' + videoId
  )}&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Could not find that video. Check the link and try again.');
  const data = await resp.json();
  return {
    title: data.title,
    author: data.author_name,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

// ---------- Routes ----------
app.post('/api/join', (req, res) => {
  const { code, name } = req.body || {};
  if (!code || code !== ROOM_CODE) {
    return res.status(403).json({ error: 'Incorrect room code.' });
  }
  const token = crypto.randomUUID();
  validTokens.add(token);
  res.json({ token, name: name || 'Friend' });
});

app.get('/api/playlist', requireAuth, async (req, res) => {
  try {
    res.json(await readPlaylist());
  } catch (e) {
    res.status(500).json({ error: 'Could not reach the database.' });
  }
});

app.post('/api/playlist', requireAuth, async (req, res) => {
  const { url, addedBy } = req.body || {};
  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Could not read a YouTube video ID from that link.' });
  }
  try {
    const meta = await fetchOEmbed(videoId);
    const list = await readPlaylist();
    if (list.some((t) => t.videoId === videoId)) {
      return res.status(409).json({ error: 'That song is already in the playlist.' });
    }
    const track = {
      id: crypto.randomUUID(),
      videoId,
      title: meta.title,
      artist: meta.author,
      thumbnail: meta.thumbnail,
      addedBy: addedBy || 'Someone',
      addedAt: new Date().toISOString(),
    };
    await addTrackToDb(track);
    const updatedList = await readPlaylist();
    io.emit('playlist:update', updatedList);
    res.json(track);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to add track.' });
  }
});

app.delete('/api/playlist/:id', requireAuth, async (req, res) => {
  try {
    await removeTrackFromDb(req.params.id);
    const updatedList = await readPlaylist();
    io.emit('playlist:update', updatedList);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove track.' });
  }
});

// Optional search - only works if YOUTUBE_API_KEY is set in .env
app.get('/api/search', requireAuth, async (req, res) => {
  const q = req.query.q;
  if (!YOUTUBE_API_KEY) {
    return res.status(400).json({ error: 'Search needs a YOUTUBE_API_KEY in .env. You can still add songs by pasting a link.' });
  }
  if (!q) return res.status(400).json({ error: 'Missing search query.' });

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      maxResults: '8',
      q,
      key: YOUTUBE_API_KEY,
    });
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    const data = await resp.json();
    if (!resp.ok) return res.status(400).json({ error: data.error?.message || 'Search failed.' });
    const results = (data.items || []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
    }));
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: 'Search failed.' });
  }
});

// ---------- Socket.io (live playlist + "now playing" sync between the two of you) ----------
io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token || !validTokens.has(token)) {
    socket.disconnect(true);
    return;
  }

  socket.on('nowPlaying', (payload) => {
    // payload: { videoId, title, thumbnail, isPlaying, by }
    socket.broadcast.emit('nowPlaying', payload);
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`🎧 MusicRoom running at http://localhost:${PORT}`);
});
