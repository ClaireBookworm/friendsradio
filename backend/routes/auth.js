/****************************************************
 * routes/auth.js (Handles ephemeral login)
 ****************************************************/
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const { store } = require('../server');

// You can define a single "room password" in .env or code
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || 'MY_SECRET';

// 1) Login route
router.post('/dj-login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  // Check if the password is correct
  if (password !== ROOM_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Create a "token" for the user
  const token = crypto.randomBytes(16).toString('hex'); 

  // Store in in-memory userSessions
  store.userSessions[token] = {
    username,
    token
  };

  console.log('Created DJ session:', {
    token,
    username,
    sessions: store.userSessions
  });

  // Return the token to the client
  return res.json({ token, username });
});

// 2) Validate token route (optional)
router.get('/me', (req, res) => {
  const { authorization } = req.headers; // e.g. "Bearer <token>"
  if (!authorization) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authorization.replace('Bearer ', '');
  const session = store.userSessions[token];
  if (!session) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  return res.json({ username: session.username });
});

module.exports = router;
