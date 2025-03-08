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
let playedTracks = [];   // Add this to track played songs

// Track current playback state
const playbackState = {
  isPlaying: false,
  currentTrack: null,
  position: 0,
  lastUpdate: Date.now()
};

// Track connected users
const connectedUsers = new Map(); // socketId -> username

// Express + Socket.IO setup
const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://friends-radio.vercel.app';
console.log('Using FRONTEND_URL:', FRONTEND_URL);

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    url: req.url,
    origin: req.headers.origin,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
  next();
});

// CORS middleware configuration
app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With', 'Accept'],
  credentials: false // Set to false since we're not using cookies
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.json());

const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false, // Set to false since we're not using cookies
    allowedHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Requested-With', 'Accept']
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
  playedTracks,    // Export playedTracks
  io,
  ROOM_PASSWORD,
  userSessions,
  playbackState,
  connectedUsers
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
  console.log('New client connected');
  
  // Handle user joining
  socket.on('user:join', (username) => {
    console.log('User joined:', username);
    
    // Store username in connectedUsers
    connectedUsers.set(socket.id, username);
    
    // Create user session
    userSessions[socket.id] = {
      username,
      socketId: socket.id
    };
    
    // Broadcast updated user list (just usernames)
    const users = Array.from(connectedUsers.values());
    io.emit('users:updated', users);
  });

  // Handle token updates separately
  socket.on('token:update', ({ accessToken }) => {
    if (userSessions[socket.id]) {
      userSessions[socket.id].accessToken = accessToken;
    }
  });

  // Handle device ID updates separately
  socket.on('device:update', ({ deviceId }) => {
    if (userSessions[socket.id]) {
      userSessions[socket.id].deviceId = deviceId;
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    
    // Remove from sessions and connected users
    if (userSessions[socket.id]) {
      delete userSessions[socket.id];
      connectedUsers.delete(socket.id);
      
      // Broadcast updated user list (just usernames)
      const users = Array.from(connectedUsers.values());
      io.emit('users:updated', users);
    }
  });

  // On connect, send both current queue and played tracks
  socket.emit('queueUpdated', {
    queue: [...trackQueue],
    playedTracks: [...playedTracks]
  });
  
  // Send current user list to the new connection (just usernames)
  socket.emit('users:update', Array.from(connectedUsers.values()));
  
  console.log('Initial queue state sent to client:', {
    socketId: socket.id,
    queueLength: trackQueue.length,
    queue: trackQueue,
    playedTracks,
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
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
