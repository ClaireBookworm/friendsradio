// In-memory storage for application state
const store = {
  // DJ sessions: { token: { username, token }, ... }
  userSessions: {},

  // Track queue and pending tracks
  trackQueue: [],
  pendingTracks: [],

  // Current playback state
  playbackState: {
    isPlaying: false,
    currentTrack: null,
    position: 0,
    lastUpdate: Date.now()
  }
};

module.exports = store; 