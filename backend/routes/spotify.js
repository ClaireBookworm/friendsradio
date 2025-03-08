const express = require('express');
const router = express.Router();
const querystring = require('querystring');
const axios = require('axios');

const { userSessions, trackQueue, playedTracks, io } = require('../server');

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
} = process.env;

const authString = Buffer.from(
  `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
).toString('base64');

// 1) Spotify OAuth login route
router.get('/login', (req, res) => {
  const scope = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
    'user-read-email',
    'user-read-private',
    'app-remote-control'
  ].join(' ');

  const qs = querystring.stringify({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope,
    redirect_uri: SPOTIFY_REDIRECT_URI,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${qs}`);
});

// 2) OAuth callback
router.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  console.log('Received callback with code:', code ? 'yes' : 'no');

  if (!code) {
    console.error('No code received in callback');
    return res.redirect('/?error=no_code');
  }

  try {
    console.log('Making token request to Spotify...');
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      querystring.stringify({
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        grant_type: 'authorization_code'
      }), {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token } = response.data;
    console.log('Successfully received tokens');
    
    // Get the frontend URL from the request origin or environment variable
    const frontendUrl = process.env.FRONTEND_URL || 'https://friends-radio.vercel.app';
    res.redirect(`${frontendUrl}/?access_token=${access_token}&refresh_token=${refresh_token}`);
  } catch (error) {
    console.error('Error in Spotify callback:', error.response?.data || error);
    res.redirect(`${process.env.FRONTEND_URL || 'https://friends-radio.vercel.app'}/?error=spotify_auth_failed`);
  }
});

// Handle POST requests for token exchange
router.post('/callback', async (req, res) => {
  const { code } = req.body;
  // console.log('Received POST callback with code:', code ? 'yes' : 'no');

  if (!code) {
    console.error('No code received in POST callback');
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    console.log('Making token request to Spotify...');
    const response = await axios.post('https://accounts.spotify.com/api/token', 
      querystring.stringify({
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        grant_type: 'authorization_code'
      }), {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token } = response.data;
    console.log('Successfully received tokens');
    
    res.json({ access_token, refresh_token });
  } catch (error) {
    console.error('Error in Spotify callback:', error.response?.data || error);
    res.status(500).json({ error: 'Failed to exchange code for tokens' });
  }
});

router.get('/token', (req, res) => {
	res.json(
	   {
		  access_token: access_token
	   })
  });

// 3) Refresh
router.get('/refresh_token', async (req, res) => {
  const refreshToken = req.query.refresh_token;
  if (!refreshToken) {
    return res.status(400).send('Missing refresh_token');
  }
  const tokenUrl = 'https://accounts.spotify.com/api/token';
  const data = querystring.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  try {
    const response = await axios.post(tokenUrl, data, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authString}`
      },
    });
    const { access_token, expires_in } = response.data;
    return res.json({ access_token, expires_in });
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error);
    return res.status(500).send('Error refreshing token');
  }
});

// 4) Add track to queue (only if DJ)
router.post('/queue', async (req, res) => {
	const { djToken, accessToken, deviceId, uri } = req.body;
	
	console.log('Queue request received:', {
		hasDjToken: !!djToken,
		hasAccessToken: !!accessToken,
		hasDeviceId: !!deviceId,
		uri,
		queueLength: trackQueue.length,
		currentQueue: trackQueue,
		timestamp: new Date().toISOString()
	});

	if (!djToken || !accessToken || !uri) {
	  return res.status(400).json({ error: 'Missing fields (djToken, accessToken, uri)' });
	}
  
	// Look up the session in userSessions
	const session = userSessions[djToken];
	console.log('Found session:', session);
	
	if (!session) {
		return res.status(403).json({ error: 'Not authorized as DJ' });
	}
  
	// Add to in-memory queue first
	const newItem = { uri, addedBy: session.username };
	trackQueue.push(newItem);
	
	try {
	  // Broadcast the updated queue to all connected clients BEFORE trying Spotify API
	  // This ensures the UI updates even if Spotify API calls fail for some users
	  io.emit('queueUpdated', {
            queue: [...trackQueue],
            playedTracks: [...playedTracks]
          });
	  console.log('Broadcasted queue update to all clients:', {
		queueLength: trackQueue.length,
		queue: trackQueue,
		playedTracks,
		timestamp: new Date().toISOString()
	  });

	  // Get all connected user sessions that have Spotify tokens
	  const connectedUsers = Object.values(userSessions).filter(user => user.accessToken);
	  
	  // Try to add to each user's Spotify queue
	  for (const user of connectedUsers) {
		try {
		  await axios.post('https://api.spotify.com/v1/me/player/queue', null, {
			headers: {
			  'Authorization': `Bearer ${user.accessToken}`,
			  'Content-Type': 'application/json'
			},
			params: {
			  uri: uri,
			  device_id: user.deviceId
			}
		  });
		  console.log(`Added track to queue for user ${user.username}`);
		} catch (error) {
		  console.error(`Failed to add track to queue for user ${user.username}:`, error.response?.data || error);
		  // Continue with other users even if one fails
		}
	  }

	  return res.json({ success: true, queue: [...trackQueue], playedTracks: [...playedTracks] });
	} catch (err) {
	  console.error('Error in queue management:', err);
	  return res.status(500).json({ error: 'Failed to manage queue' });
	}
});

/**
 * DELETE /spotify/queue
 *  Remove a track by index from the in-memory queue (DJ only).
 *  e.g. { djToken, index: 2 }
 */
router.delete('/queue', (req, res) => {
	const { djToken, index } = req.body;
	console.log('Delete queue request:', { 
		hasDjToken: !!djToken, 
		index, 
		queueLength: trackQueue.length,
		currentQueue: trackQueue,
		timestamp: new Date().toISOString()
	});

	if (!djToken || index === undefined) {
	  return res.status(400).json({ error: 'Missing djToken or index' });
	}
  
	// Look up the session in userSessions
	const session = userSessions[djToken];
	if (!session) {
		return res.status(403).json({ error: 'Not authorized as DJ' });
	}
  
	// Validate index
	const idx = parseInt(index, 10);
	if (isNaN(idx) || idx < 0 || idx >= trackQueue.length) {
	  return res.status(400).json({ error: 'Invalid index' });
	}
  
	// Remove it from the array
	const removedTrack = trackQueue.splice(idx, 1)[0];
	console.log('Queue after removal:', {
		removedTrack,
		queueLength: trackQueue.length,
		queue: trackQueue,
		timestamp: new Date().toISOString()
	});
  
	// Broadcast the updated queue to all connected clients
	io.emit('queueUpdated', [...trackQueue]); // Send a new array to ensure changes are detected
	console.log('Broadcasted queue update after removal:', {
		queueLength: trackQueue.length,
		queue: trackQueue,
		timestamp: new Date().toISOString()
	});
  
	return res.json({ success: true, queue: [...trackQueue] }); // Send a new array in the response
});

// 5) Skip track (DJ only)
router.post('/skip', async (req, res) => {
  const { djToken, accessToken, deviceId } = req.body;
  if (!djToken || !accessToken) {
    return res.status(400).json({ error: 'Missing djToken or accessToken' });
  }
  // Look up the session in userSessions
  const session = userSessions[djToken];
  if (!session) {
    return res.status(403).json({ error: 'Not authorized as DJ' });
  }

  try {
    // Get currently playing track before skipping
    const currentTrack = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (currentTrack.data && currentTrack.data.item) {
      // Add current track to played tracks
      playedTracks.push(currentTrack.data.item.uri);
    }

    // Skip only once using the DJ's token
    await axios.post('https://api.spotify.com/v1/me/player/next', null, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      params: {
        device_id: deviceId
      }
    });

    // Broadcast the skip action and updated queues to all clients
    io.emit('playback:skip');
    io.emit('queueUpdated', {
      queue: [...trackQueue],
      playedTracks: [...playedTracks]
    });
    
    return res.json({ success: true });
  } catch (err) {
    console.error('Error skipping track:', err.response?.data || err);
    return res.status(500).send('Error skipping track');
  }
});

// 6) Play/Pause track (DJ only)
router.put('/playback', async (req, res) => {
  const { djToken, accessToken, deviceId, action } = req.body;
  
  if (!djToken || !accessToken || !deviceId || !action) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Verify DJ authorization
  const session = userSessions[djToken];
  if (!session) {
    return res.status(403).json({ error: 'Not authorized as DJ' });
  }

  try {
    // Get all connected user sessions that have Spotify tokens
    const connectedUsers = Object.values(userSessions).filter(user => user.accessToken);
    
    // Try to update playback state for each connected user
    for (const user of connectedUsers) {
      try {
        await axios.put(`https://api.spotify.com/v1/me/player/${action}`, null, {
          headers: {
            Authorization: `Bearer ${user.accessToken}`
          },
          params: {
            device_id: user.deviceId
          }
        });
        console.log(`${action} successful for user ${user.username}`);
      } catch (error) {
        console.error(`Failed to ${action} for user ${user.username}:`, error.response?.data || error);
        // Continue with other users even if one fails
      }
    }

    // Broadcast the playback state change to all clients
    io.emit('playback:stateChange', { action });
    return res.json({ success: true, action });
  } catch (err) {
    console.error(`Error ${action}ing track:`, err.response?.data || err);
    return res.status(500).json({ error: `Failed to ${action} track` });
  }
});

module.exports = router;
