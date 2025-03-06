import React, { useEffect, useState } from 'react';
import axios from 'axios';

function QueueList({ queue, accessToken }) {
  const [trackNames, setTrackNames] = useState({});

  // Function to get track name from Spotify
  const getTrackName = async (uri) => {
    if (!uri || !accessToken) return '';
    const trackId = uri.split(':')[2];
    try {
      const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      return `${response.data.name} - ${response.data.artists[0].name}`;
    } catch (error) {
      console.error('Error fetching track name:', error);
      return uri;
    }
  };

  // Update track names when queue changes
  useEffect(() => {
    const updateTrackNames = async () => {
      const newTrackNames = {};
      for (const item of queue) {
        if (!trackNames[item.uri]) {
          newTrackNames[item.uri] = await getTrackName(item.uri);
        }
      }
      setTrackNames(prev => ({ ...prev, ...newTrackNames }));
    };
    updateTrackNames();
  }, [queue, accessToken]);

  return (
    <div className="queue-container">
      <h3 className="heading">Current Queue</h3>
      <div className="queue-scroll">
        {queue.length === 0 ? (
          <p className="text-muted">No tracks in queue</p>
        ) : (
          <ul className="list-unstyled">
            {queue.map((item, idx) => (
              <li key={idx} className="queue-item">
                <div className="queue-item-content">
                  <span className="queue-number">{idx + 1}.</span>
                  <span className="queue-track">{trackNames[item.uri] || 'Loading...'}</span>
                  <span className="queue-added-by">dj {item.addedBy}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default QueueList;
