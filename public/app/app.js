(() => {
  // ---------- State ----------
  let token = localStorage.getItem('musicroom_token') || null;
  let myName = localStorage.getItem('musicroom_name') || 'Friend';
  let playlist = [];
  let currentIndex = -1;
  let isPlaying = false;
  let socket = null;
  let isSeeking = false;

  // ---------- DOM refs ----------
  const joinScreen = document.getElementById('join-screen');
  const appScreen = document.getElementById('app-screen');
  const joinForm = document.getElementById('join-form');
  const nameInput = document.getElementById('name-input');
  const codeInput = document.getElementById('code-input');
  const joinError = document.getElementById('join-error');

  const backdrop = document.getElementById('backdrop');
  const coverArt = document.getElementById('cover-art');
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const seekBar = document.getElementById('seek-bar');
  const timeCurrent = document.getElementById('time-current');
  const timeDuration = document.getElementById('time-duration');
  const btnPrev = document.getElementById('btn-prev');
  const btnPlayPause = document.getElementById('btn-playpause');
  const btnNext = document.getElementById('btn-next');
  const volumeBar = document.getElementById('volume-bar');
  const nowPlayingFriend = document.getElementById('now-playing-friend');

  const addForm = document.getElementById('add-form');
  const addInput = document.getElementById('add-input');
  const addError = document.getElementById('add-error');
  const playlistList = document.getElementById('playlist-list');

  // ---------- Helpers ----------
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async function api(path, options = {}) {
    const resp = await fetch('/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-room-token': token || '',
        ...(options.headers || {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---------- Join flow ----------
  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const name = nameInput.value.trim();
    const code = codeInput.value.trim();
    try {
      const data = await api('/join', {
        method: 'POST',
        body: JSON.stringify({ code, name }),
      });
      token = data.token;
      myName = data.name;
      localStorage.setItem('musicroom_token', token);
      localStorage.setItem('musicroom_name', myName);
      enterApp();
    } catch (err) {
      joinError.textContent = err.message;
    }
  });

  async function tryAutoJoin() {
    if (!token) return;
    try {
      await api('/playlist'); // will 401 if token invalid
      enterApp();
    } catch (err) {
      localStorage.removeItem('musicroom_token');
      token = null;
    }
  }

  async function enterApp() {
    joinScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    connectSocket();
    await loadPlaylist();
  }

  // ---------- Socket.io ----------
  function connectSocket() {
    socket = io({ auth: { token } });

    socket.on('playlist:update', (list) => {
      const currentTrackId = currentIndex >= 0 ? playlist[currentIndex]?.id : null;
      playlist = list;
      if (currentTrackId) {
        currentIndex = playlist.findIndex((t) => t.id === currentTrackId);
      }
      renderPlaylist();
    });

    socket.on('nowPlaying', (payload) => {
      if (!payload) return;
      nowPlayingFriend.textContent = payload.isPlaying
        ? `🎧 ${payload.by} is listening to ${payload.title}`
        : '';
      nowPlayingFriend.classList.toggle('hidden', !payload.isPlaying);
    });
  }

  function broadcastNowPlaying() {
    if (!socket) return;
    const track = playlist[currentIndex];
    socket.emit('nowPlaying', {
      videoId: track?.videoId,
      title: track?.title,
      by: myName,
      isPlaying,
    });
  }

  // ---------- Playlist ----------
  async function loadPlaylist() {
    playlist = await api('/playlist');
    renderPlaylist();
  }

  function renderPlaylist() {
    playlistList.innerHTML = '';
    playlist.forEach((track, idx) => {
      const li = document.createElement('li');
      li.className = 'playlist-item' + (idx === currentIndex ? ' active' : '');
      li.innerHTML = `
        <img src="${track.thumbnail}" alt="" />
        <div class="playlist-item-text">
          <div class="pi-title">${escapeHtml(track.title)}</div>
          <div class="pi-meta">${escapeHtml(track.artist || '')} · added by ${escapeHtml(track.addedBy)}</div>
        </div>
        <button class="pi-remove" title="Remove">✕</button>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.pi-remove')) return;
        playTrackAt(idx);
      });
      li.querySelector('.pi-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await api(`/playlist/${track.id}`, { method: 'DELETE' });
        } catch (err) {
          alert(err.message);
        }
      });
      playlistList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addError.textContent = '';
    const url = addInput.value.trim();
    if (!url) return;
    try {
      await api('/playlist', {
        method: 'POST',
        body: JSON.stringify({ url, addedBy: myName }),
      });
      addInput.value = '';
    } catch (err) {
      addError.textContent = err.message;
    }
  });

  // ---------- Player controls ----------
  function playTrackAt(idx) {
    if (idx < 0 || idx >= playlist.length) return;
    currentIndex = idx;
    const track = playlist[idx];
    coverArt.src = track.thumbnail;
    backdrop.style.backgroundImage = `url(${track.thumbnail})`;
    trackTitle.textContent = track.title;
    trackArtist.textContent = track.artist || '';
    MusicPlayer.loadVideo(track.videoId, true);
    renderPlaylist();
  }

  btnPlayPause.addEventListener('click', () => {
    if (currentIndex === -1 && playlist.length > 0) {
      playTrackAt(0);
      return;
    }
    if (isPlaying) {
      MusicPlayer.pause();
    } else {
      MusicPlayer.play();
    }
  });

  btnNext.addEventListener('click', () => {
    if (playlist.length === 0) return;
    const next = (currentIndex + 1) % playlist.length;
    playTrackAt(next);
  });

  btnPrev.addEventListener('click', () => {
    if (playlist.length === 0) return;
    const prev = (currentIndex - 1 + playlist.length) % playlist.length;
    playTrackAt(prev);
  });

  seekBar.addEventListener('input', () => { isSeeking = true; });
  seekBar.addEventListener('change', () => {
    const duration = MusicPlayer.getDuration();
    const seconds = (seekBar.value / 100) * duration;
    MusicPlayer.seekTo(seconds);
    isSeeking = false;
  });

  volumeBar.addEventListener('input', () => {
    MusicPlayer.setVolume(Number(volumeBar.value));
  });

  // ---------- MusicPlayer event wiring ----------
  MusicPlayer.on('ready', () => {
    MusicPlayer.setVolume(Number(volumeBar.value));
  });

  MusicPlayer.on('stateChange', (state) => {
    // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    isPlaying = state === 1;
    btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
    coverArt.classList.toggle('playing', isPlaying);
    broadcastNowPlaying();
  });

  MusicPlayer.on('ended', () => {
    if (playlist.length === 0) return;
    const next = (currentIndex + 1) % playlist.length;
    playTrackAt(next);
  });

  MusicPlayer.on('timeUpdate', ({ current, duration }) => {
    timeCurrent.textContent = formatTime(current);
    timeDuration.textContent = formatTime(duration);
    if (!isSeeking && duration > 0) {
      seekBar.value = (current / duration) * 100;
    }
  });

  // ---------- Boot ----------
  tryAutoJoin();
})();
