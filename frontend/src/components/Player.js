import React, { useEffect, useState } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://friendsradio-production.up.railway.app';

function Player({ accessToken, djToken, onDeviceIdChange, socket }) {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isTransferringPlayback, setIsTransferringPlayback] = useState(false);

  // Function to transfer playback to this device
  const transferPlayback = async (deviceId) => {
    try {
      setIsTransferringPlayback(true);
      await axios.put('https://api.spotify.com/v1/me/player', 
        {
          device_ids: [deviceId],
          play: true
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('Successfully transferred playback to web player');
    } catch (error) {
      console.error('Error transferring playback:', error);
    } finally {
      setIsTransferringPlayback(false);
    }
  };

  useEffect(() => {
    if (!accessToken) return;

    // Load Spotify Web Playback SDK
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Retro Friends Radio',
        getOAuthToken: cb => { cb(accessToken); },
        volume: 0.5
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        setIsReady(true);
        onDeviceIdChange(device_id);
        // Transfer playback to this device when it's ready
        transferPlayback(device_id);
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        setDeviceId('');
        setIsReady(false);
        onDeviceIdChange('');
      });

      player.addListener('player_state_changed', (state) => {
        if (!state) return;
        console.log('Player state changed:', state);
        setIsPlaying(!state.paused);
        
        // Update current track info
        if (state.track_window?.current_track) {
          const track = state.track_window.current_track;
          setCurrentTrack({
            name: track.name,
            artist: track.artists[0].name,
            album: track.album.name
          });
        }

        // If we're the DJ, broadcast the current state
        if (djToken) {
          socket.emit('playbackUpdate', {
            djToken,
            isPlaying: !state.paused,
            currentTrack: state.track_window.current_track,
            position: state.position,
          });
        }
      });

      player.connect();
      setPlayer(player);
    };

    return () => {
      if (player) {
        player.disconnect();
      }
    };
  }, [accessToken, onDeviceIdChange, socket]);

  // Listen for playback state updates
  useEffect(() => {
    if (!socket || !player || !isReady) return;

    // Listen for playback state changes from DJ
    socket.on('playback:stateChange', async ({ action }) => {
      if (!player) return;
      
      try {
        if (action === 'play') {
          await player.resume();
          setIsPlaying(true);
        } else if (action === 'pause') {
          await player.pause();
          setIsPlaying(false);
        }
      } catch (error) {
        console.error('Error syncing playback state:', error);
      }
    });

    // Listen for general playback state updates
    socket.on('playbackState', async (state) => {
      if (!state.currentTrack) return;

      try {
        // If we're not the DJ, sync our playback
        if (!djToken) {
          // Calculate time drift since last update
          const drift = (Date.now() - state.lastUpdate) / 1000;
          const position = state.position + (drift * 1000);

          // Resume playback at the current position with the current track
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              uris: [state.currentTrack.uri],
              position_ms: position
            })
          });

          // Update local state
          setIsPlaying(state.isPlaying);
          if (state.currentTrack) {
            setCurrentTrack({
              name: state.currentTrack.name,
              artist: state.currentTrack.artists[0].name,
              album: state.currentTrack.album.name
            });
          }
        }
      } catch (error) {
        console.error('Error syncing playback:', error);
      }
    });

    return () => {
      socket.off('playback:stateChange');
      socket.off('playbackState');
    };
  }, [socket, player, isReady, deviceId, accessToken, djToken]);

  const handlePlayPause = async () => {
    if (!djToken) {
      alert('You must be the DJ to control playback!');
      return;
    }

    try {
      const action = isPlaying ? 'pause' : 'play';
      await axios.put(`${BACKEND_URL}/spotify/playback`, {
        djToken,
        accessToken,
        deviceId,
        action
      });
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error('Error controlling playback:', error);
      alert('Failed to control playback');
    }
  };

  const handleSkip = async () => {
    if (!djToken) {
      alert('You must be the DJ to skip!');
      return;
    }

    // Add a flag to prevent double execution
    if (handleSkip.isSkipping) return;
    
    try {
      handleSkip.isSkipping = true;
      await axios.post(`${BACKEND_URL}/spotify/skip`, {
        djToken,
        accessToken,
        deviceId
      });
    } catch (err) {
      console.error('Skip track error:', err);
      alert('Failed to skip track');
    } finally {
      // Reset the flag after a delay
      setTimeout(() => {
        handleSkip.isSkipping = false;
      }, 1000);
    }
  };

  useEffect(() => {
    if (!socket || !accessToken || !deviceId) return;

    let skipInProgress = false;

    // Handle skip events
    socket.on('playback:skip', async () => {
      if (!djToken && !skipInProgress) { // Only non-DJ users should sync
        try {
          skipInProgress = true;
          
          await axios.post('https://api.spotify.com/v1/me/player/next', null, {
            headers: {
              Authorization: `Bearer ${accessToken}`
            },
            params: {
              device_id: deviceId
            }
          });
        } catch (error) {
          console.error('Error syncing skip:', error);
        } finally {
          setTimeout(() => {
            skipInProgress = false;
          }, 1000);
        }
      }
    });

    return () => {
      socket.off('playback:skip');
    };
  }, [socket, accessToken, deviceId, djToken]);

  return (
    <div className="player-container">
      <h2 className="heading">Now Playing</h2>
      {deviceId ? (
        <div>
          {isTransferringPlayback && (
            <p className="status-message">Connecting to your Spotify...</p>
          )}
          {currentTrack && (
            <div className="now-playing-card">
              <div className="track-info">
                <p className="track-name">{currentTrack.name}</p>
                <p className="track-artist">{currentTrack.artist}</p>
                <p className="track-album">{currentTrack.album}</p>
              </div>
              {djToken && (
                <div className="player-controls">
                  <button 
                    onClick={handlePlayPause}
                    className="button"
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button 
                    onClick={handleSkip}
                    className="button"
                  >
                    Skip →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="status-message">Waiting for Spotify Player to connect...</p>
      )}
    </div>
  );
}

export default Player;
