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

// In-memory DJ session: { token, username, etc. }
let userSessions = {}; // { token: { username, token }, ... }

// In-memory track queue
let trackQueue = [];
let pendingTracks = [];  // Add this to store pending tracks

// Track current playback state
const playbackState = {
  isPlaying: false,
  currentTrack: null,
  position: 0,
  lastUpdate: Date.now()
};

const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://friends-radio.vercel.app',
  'http://localhost:2000',  // Local development
  'https://railway.app'     // Railway domain
];

// Express + Socket.IO setup
const app = express();

// Enable pre-flight requests for all routes
app.options('*', cors());

app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: true, // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling']
});

// Provide references to other modules if needed
module.exports = {
//   djSession,
//   setDjSession: (obj) => (djSession = obj),
//   clearDjSession: () => (djSession = null),
  trackQueue,
  pendingTracks,  // Export pendingTracks
  io,
  ROOM_PASSWORD,
  userSessions,
  playbackState
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
    queueLength: trackQueue.length,
    queue: trackQueue
  });

  // On connect, send both current queue and pending tracks
  socket.emit('queueUpdated', trackQueue);
  socket.emit('pendingTracksUpdated', pendingTracks);
  console.log('Initial queue state sent to client:', {
    socketId: socket.id,
    queueLength: trackQueue.length,
    queue: trackQueue,
    timestamp: new Date().toISOString()
  });

  // Handle request for current queue state
  socket.on('requestQueue', () => {
    console.log('Queue requested by client:', {
      socketId: socket.id,
      queueLength: trackQueue.length,
      queue: trackQueue,
      timestamp: new Date().toISOString()
    });
    socket.emit('queueUpdated', trackQueue);
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
    pendingTracks = tracks;
    io.emit('pendingTracksUpdated', pendingTracks);
  });

  // Send current playback state to new users
  socket.emit('playbackState', playbackState);
  
  // Listen for playback updates from DJ
  socket.on('playbackUpdate', (state) => {
    if (userSessions[state.djToken]) {  // Verify it's from the DJ
      console.log('Playback update from DJ:', {
        socketId: socket.id,
        isPlaying: state.isPlaying,
        currentTrack: state.currentTrack?.name,
        position: state.position,
        timestamp: new Date().toISOString()
      });
      
      playbackState.isPlaying = state.isPlaying;
      playbackState.currentTrack = state.currentTrack;
      playbackState.position = state.position;
      playbackState.lastUpdate = Date.now();
      
      // Broadcast to all other clients
      socket.broadcast.emit('playbackState', playbackState);
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
});
