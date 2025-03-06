const express = require('express');
const router = express.Router();
const querystring = require('querystring');
const axios = require('axios');

const { userSessions, trackQueue, io } = require('../server');

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
    'user-read-private'
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
  
	// Add to in-memory queue
	const newItem = { uri, addedBy: session.username };
	trackQueue.push(newItem);
	console.log('Updated queue after adding track:', {
		newItem,
		queueLength: trackQueue.length,
		queue: trackQueue,
		timestamp: new Date().toISOString()
	});
  
	// Add to Spotify queue
	try {
	  await axios.post(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri)}`, null, {
		headers: {
		  'Authorization': `Bearer ${accessToken}`,
		},
		params: {
		  device_id: deviceId
		}
	  });

	  // Broadcast the updated queue to all connected clients
	  io.emit('queueUpdated', [...trackQueue]); // Send a new array to ensure changes are detected
	  console.log('Broadcasted queue update to all clients:', {
		queueLength: trackQueue.length,
		queue: trackQueue,
		timestamp: new Date().toISOString()
	  });

	  return res.json({ success: true, queue: [...trackQueue] }); // Send a new array in the response
	} catch (err) {
	  console.error('Error adding track to Spotify queue:', err.response?.data || err);
	  // Remove from in-memory queue if Spotify call fails
	  trackQueue.pop();
	  console.log('Removed track from queue after Spotify error:', {
		queueLength: trackQueue.length,
		queue: trackQueue,
		timestamp: new Date().toISOString()
	  });
	  return res.status(500).json({ error: 'Failed to add track to Spotify queue' });
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
    await axios.post('https://api.spotify.com/v1/me/player/next', null, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      params: {
        device_id: deviceId
      }
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
    // Determine the endpoint based on the action
    const endpoint = action === 'play' ? 'play' : 'pause';
    
    await axios.put(`https://api.spotify.com/v1/me/player/${endpoint}`, null, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      params: {
        device_id: deviceId
      }
    });

    return res.json({ success: true, action });
  } catch (err) {
    console.error(`Error ${action}ing track:`, err.response?.data || err);
    return res.status(500).json({ error: `Failed to ${action} track` });
  }
});

module.exports = router;
