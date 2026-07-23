/**
 * MusicPlayer wraps the YouTube IFrame Player API so the rest of the app
 * never has to touch YouTube's video UI directly. The iframe itself stays
 * hidden off-screen (see #yt-player-mount in CSS) - only cover art, title,
 * and custom controls are ever shown to the user.
 */
const MusicPlayer = (() => {
  let ytPlayer = null;
  let isReady = false;
  let pendingVideoId = null;
  let timeUpdateInterval = null;

  const listeners = {
    ready: [],
    stateChange: [],
    timeUpdate: [],
    ended: [],
  };

  function on(event, cb) {
    if (listeners[event]) listeners[event].push(cb);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  // Called automatically by the YouTube iframe_api script once it loads
  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player('yt-player-mount', {
      height: '1',
      width: '1',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        fs: 0,
      },
      events: {
        onReady: () => {
          isReady = true;
          emit('ready');
          if (pendingVideoId) {
            ytPlayer.cueVideoById(pendingVideoId);
            pendingVideoId = null;
          }
        },
        onStateChange: (e) => {
          emit('stateChange', e.data);
          if (e.data === YT.PlayerState.ENDED) emit('ended');
        },
      },
    });
  };

  function startTimeUpdates() {
    stopTimeUpdates();
    timeUpdateInterval = setInterval(() => {
      if (!ytPlayer || !isReady) return;
      const current = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
      const duration = ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
      emit('timeUpdate', { current, duration });
    }, 500);
  }

  function stopTimeUpdates() {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  }

  return {
    on,
    isReady: () => isReady,

    loadVideo(videoId, autoplay = true) {
      if (!isReady) {
        pendingVideoId = videoId;
        return;
      }
      if (autoplay) {
        ytPlayer.loadVideoById(videoId);
      } else {
        ytPlayer.cueVideoById(videoId);
      }
      startTimeUpdates();
    },

    play() {
      if (ytPlayer && isReady) ytPlayer.playVideo();
    },

    pause() {
      if (ytPlayer && isReady) ytPlayer.pauseVideo();
    },

    seekTo(seconds) {
      if (ytPlayer && isReady) ytPlayer.seekTo(seconds, true);
    },

    setVolume(vol) {
      if (ytPlayer && isReady) ytPlayer.setVolume(vol);
    },

    getCurrentTime() {
      return ytPlayer && isReady ? ytPlayer.getCurrentTime() : 0;
    },

    getDuration() {
      return ytPlayer && isReady ? ytPlayer.getDuration() : 0;
    },

    getPlayerState() {
      return ytPlayer && isReady ? ytPlayer.getPlayerState() : -1;
    },
  };
})();
