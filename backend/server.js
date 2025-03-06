/****************************************************
 * server.js
 ****************************************************/
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');

// Load environment variables
// e.g. ROOM_PASSWORD in your .env
const { ROOM_PASSWORD } = process.env;

// Load shared store
const store = require('./store');

// Express + Socket.IO setup
const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:2000',
  credentials: true
}));
app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:2000',
    credentials: true
  }
});

// Debug: Log queue state changes
function logQueueState(action) {
  console.log(`Queue state (${action}):`, {
    queueLength: store.trackQueue.length,
    queue: store.trackQueue,
    timestamp: new Date().toISOString()
  });
}

// Provide references to other modules if needed
module.exports = {
  io,
  ROOM_PASSWORD,
  store
};

// Register routes
const spotifyRoutes = require('./routes/spotify');
const authRoutes = require('./routes/auth');
app.use('/spotify', spotifyRoutes);
app.use('/auth', authRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Socket connected:', {
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    queueLength: store.trackQueue.length,
    queue: store.trackQueue
  });

  // On connect, send both current queue and pending tracks
  socket.emit('queueUpdated', store.trackQueue);
  socket.emit('pendingTracksUpdated', store.pendingTracks);
  console.log('Initial queue state sent to client:', {
    socketId: socket.id,
    queueLength: store.trackQueue.length,
    queue: store.trackQueue,
    timestamp: new Date().toISOString()
  });

  // Handle request for current queue state
  socket.on('requestQueue', () => {
    console.log('Queue requested by client:', {
      socketId: socket.id,
      queueLength: store.trackQueue.length,
      queue: store.trackQueue,
      timestamp: new Date().toISOString()
    });
    socket.emit('queueUpdated', store.trackQueue);
  });

  // Handle chat messages
  socket.on('chat message', (message) => {
    console.log('Received chat message:', message);
    io.emit('chat message', message);
  });

  // Handle pending tracks updates
  socket.on('pendingTracksUpdate', (tracks) => {
    console.log('Pending tracks updated:', {
      socketId: socket.id,
      tracksLength: tracks.length,
      tracks,
      timestamp: new Date().toISOString()
    });
    store.pendingTracks = tracks;
    io.emit('pendingTracksUpdated', store.pendingTracks);
  });

  // Send current playback state to new users
  socket.emit('playbackState', store.playbackState);
  
  // Listen for playback updates from DJ
  socket.on('playbackUpdate', (state) => {
    if (store.userSessions[state.djToken]) {  // Verify it's from the DJ
      console.log('Playback update from DJ:', {
        socketId: socket.id,
        isPlaying: state.isPlaying,
        currentTrack: state.currentTrack?.name,
        position: state.position,
        timestamp: new Date().toISOString()
      });
      
      store.playbackState.isPlaying = state.isPlaying;
      store.playbackState.currentTrack = state.currentTrack;
      store.playbackState.position = state.position;
      store.playbackState.lastUpdate = Date.now();
      
      // Broadcast to all other clients
      socket.broadcast.emit('playbackState', store.playbackState);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', {
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logQueueState('server-start');
});
