import React, { useState, useEffect } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://friendsradio-production.up.railway.app';

function Controls({ socket, djToken, accessToken, deviceId, queue, setQueue }) {
	// `queue` and `setQueue` are optional props if you want to
	// keep a local copy in React for immediate UI updates.
	console.log("Controls component initialized with:", {
		BACKEND_URL,
		hasDjToken: !!djToken,
		hasAccessToken: !!accessToken,
		deviceId
	});
	

	const [trackNames, setTrackNames] = useState({});
	const [pendingTracks, setPendingTracks] = useState([]);
	const [isProcessing, setIsProcessing] = useState(false);
	const [retryTimeout, setRetryTimeout] = useState(null);
	const [inputLink, setInputLink] = useState('');
	const [error, setError] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [currentTrackUri, setCurrentTrackUri] = useState(null);
	const [playedSongs, setPlayedSongs] = useState([]);

	// Helper: parse a Spotify link and return { type: 'track'/'playlist', id: '...' }
	function parseSpotifyLink(link) {
		let type = null;
		let id = null;

		// Check for "spotify:track:" or "spotify:playlist:"
		if (link.startsWith('spotify:track:')) {
			type = 'track';
			id = link.replace('spotify:track:', '');
		} else if (link.startsWith('spotify:playlist:')) {
			type = 'playlist';
			id = link.replace('spotify:playlist:', '');
		} else {
			// Handle https URL
			const regex = /https?:\/\/open\.spotify\.com\/(track|playlist)\/([^?/]+)/;
			const match = link.match(regex);
			if (match) {
				type = match[1];
				id = match[2];
			}
		}
		return { type, id };
	}

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
			// If we get a 401 (Unauthorized), the token might be expired
			if (error.response?.status === 401) {
				return 'Token expired - Please reconnect Spotify';
			}
			console.error('Error fetching track name:', error);
			return 'Error loading track info';
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

	// Process pending tracks with exponential backoff
	const processPendingTracks = async () => {
		if (pendingTracks.length === 0 || isProcessing) return;

		setIsProcessing(true);
		const track = pendingTracks[0];
		
		try {
			await axios.post(`${BACKEND_URL}/spotify/queue`, {
				djToken,
				accessToken,
				deviceId,
				uri: track.uri
			});
			
			// Successfully added, remove from pending and notify all users
			const newPendingTracks = pendingTracks.slice(1);
			setPendingTracks(newPendingTracks);
			socket.emit('pendingTracksUpdate', newPendingTracks);
			// Reset retry timeout since we succeeded
			setRetryTimeout(1000);
		} catch (error) {
			console.error('Error processing pending track:', error);
			if (error.response?.status === 429) {
				// Rate limited - wait longer before next attempt
				const newTimeout = (retryTimeout || 1000) * 1.5; // Exponential backoff
				setRetryTimeout(newTimeout);
				console.log(`Rate limited. Waiting ${newTimeout/1000} seconds before retry...`);
				setTimeout(() => {
					setIsProcessing(false);
					processPendingTracks();
				}, newTimeout);
				return;
			}
		}
		
		setIsProcessing(false);
	};

	// Listen for pending tracks updates from other users
	useEffect(() => {
		socket.on('pendingTracksUpdated', (tracks) => {
			setPendingTracks(tracks);
		});

		return () => {
			socket.off('pendingTracksUpdated');
		};
	}, [socket]);

	const handleAddTrack = async (uri) => {
		try {
			console.log('Adding track to queue:', {
				uri,
				BACKEND_URL,
				hasDjToken: !!djToken,
				hasAccessToken: !!accessToken,
				deviceId
			});
			
			const response = await axios.post(`${BACKEND_URL}/spotify/queue`, {
				djToken,
				accessToken,
				deviceId,
				uri
			}, {
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				}
			});

			console.log('Add track response:', response.data);

			if (!response.data.success) {
				throw new Error('Failed to add track');
			}
		} catch (err) {
			console.error('Error adding track:', err);
			throw err;
		}
	};

	async function handleAddPlaylist(playlistId) {
		try {
			const resp = await axios.get(
				`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				}
			);
			const items = resp.data.items || [];
			for (let item of items) {
				if (item.track && item.track.uri) {
					await handleAddTrack(item.track.uri);
				}
			}
		} catch (err) {
			console.error('Error adding playlist:', err);
			throw err;
		}
	}

	// Function to search Spotify for tracks
	const searchTracks = async (query) => {
		try {
			const response = await axios.get(
				`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`
					}
				}
			);
			return response.data.tracks.items;
		} catch (error) {
			console.error('Error searching tracks:', error);
			throw error;
		}
	};

	const [searchResults, setSearchResults] = useState([]);
	const [isSearching, setIsSearching] = useState(false);
	const [selectedTrack, setSelectedTrack] = useState(null);

	// Debounced search function
	useEffect(() => {
		if (!inputLink || inputLink.includes('spotify.com') || inputLink.startsWith('spotify:')) {
			setSearchResults([]);
			return;
		}

		const delayDebounceFn = setTimeout(async () => {
			setIsSearching(true);
			try {
				const results = await searchTracks(inputLink);
				setSearchResults(results);
			} catch (error) {
				setError('Failed to search tracks');
			} finally {
				setIsSearching(false);
			}
		}, 500); // Wait 500ms after user stops typing

		return () => clearTimeout(delayDebounceFn);
	}, [inputLink, accessToken]);

	const handleSubmit = async (e) => {
		e.preventDefault();
		if (!inputLink.trim() || !djToken || !deviceId) return;
		
		setError('');
		setIsLoading(true);

		try {
			let trackUri;
			
			// If a track was selected from search results, use that
			if (selectedTrack) {
				trackUri = selectedTrack.uri;
			} else {
				// Otherwise try to parse as a Spotify link
				const { type, id } = parseSpotifyLink(inputLink.trim());
				if (!type || !id) {
					throw new Error('Please select a track from the search results or provide a valid Spotify link.');
				}
				if (type === 'track') {
					trackUri = `spotify:track:${id}`;
				} else if (type === 'playlist') {
					await handleAddPlaylist(id);
					setInputLink('');
					setIsLoading(false);
					return;
				}
			}

			await handleAddTrack(trackUri);
			setInputLink('');
			setSelectedTrack(null);
			setSearchResults([]);
		} catch (err) {
			console.error('Error adding to queue:', err);
			setError(err.message || 'Failed to add to queue');
		} finally {
			setIsLoading(false);
		}
	};

	// Removing a track from queue by index
	const handleRemoveTrack = async (index) => {
		if (!djToken) return;

		try {
			console.log('Removing track:', {
				index,
				BACKEND_URL,
				hasDjToken: !!djToken
			});

			const resp = await axios.delete(`${BACKEND_URL}/spotify/queue`, {
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				data: {
					djToken,
					index
				}
			});
			
			console.log('Remove track response:', resp.data);
			
			if (resp.data.queue) {
				setQueue && setQueue(resp.data.queue);
			}
		} catch (err) {
			console.error('Error removing track:', err);
		}
	};

	// Add effect to track currently playing song
	useEffect(() => {
		const checkCurrentTrack = async () => {
			try {
				const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
					headers: {
						Authorization: `Bearer ${accessToken}`
					}
				});

				if (response.data && response.data.item) {
					const newTrackUri = response.data.item.uri;
					if (newTrackUri !== currentTrackUri) {
						// If we have a previous track, remove it from the queue and trackNames
						if (currentTrackUri) {
							// Remove from trackNames cache
							setTrackNames(prev => {
								const newTrackNames = { ...prev };
								delete newTrackNames[currentTrackUri];
								return newTrackNames;
							});

							// Remove from queue
							setQueue(prev => prev.filter(item => item.uri !== currentTrackUri));

							// Notify other clients about the queue update
							socket.emit('queueUpdated', queue.filter(item => item.uri !== currentTrackUri));
						}
						setCurrentTrackUri(newTrackUri);
					}
				}
			} catch (error) {
				console.error('Error checking current track:', error);
			}
		};

		const interval = setInterval(checkCurrentTrack, 5000);
		return () => clearInterval(interval);
	}, [accessToken, currentTrackUri, queue, socket]);

	return (
		<div className="controls-container">
			<form onSubmit={handleSubmit} className="input-group">
				<div className="search-container">
					<input
						className="input"
						value={inputLink}
						onChange={(e) => {
							setInputLink(e.target.value);
							setSelectedTrack(null);
						}}
						placeholder="Search for a song or paste a Spotify link..."
						disabled={!djToken || !deviceId || isLoading}
					/>
					{isSearching && (
						<div className="search-loading">Searching...</div>
					)}
					{searchResults.length > 0 && (
						<ul className="search-results list-unstyled">
							{searchResults.map((track) => (
								<li
									key={track.id}
									className={`search-result ${selectedTrack?.id === track.id ? 'selected' : ''}`}
									onClick={() => {
										setSelectedTrack(track);
										setInputLink(`${track.name} - ${track.artists[0].name}`);
										setSearchResults([]);
									}}
								>
									<div className="search-result-info">
										<strong>{track.name}</strong>
										<span className="search-result-artist">
											{track.artists[0].name}
										</span>
									</div>
									<span className="search-result-duration">
										{Math.floor(track.duration_ms / 60000)}:
										{String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}
									</span>
								</li>
							))}
						</ul>
					)}
				</div>
				<button
					type="submit"
					className={`button ${(!inputLink.trim() || !deviceId || !djToken || isLoading) ? 'disabled' : ''}`}
					disabled={!inputLink.trim() || !deviceId || !djToken || isLoading}
				>
					{isLoading ? 'Adding...' : 'Add to Queue'}
				</button>
			</form>
			{error && <div className="error-text">{error}</div>}

			{pendingTracks.length > 0 && (
				<div className="pending-tracks card">
					<h4>Pending Tracks ({pendingTracks.length})</h4>
					<p className="text-primary">
						{isProcessing ? 'Retrying to add tracks...' : 'Waiting to retry...'}
					</p>
					<ul className="list-unstyled">
						{pendingTracks.map((track, idx) => (
							<li key={idx}>
								{trackNames[track.uri] || track.uri}
							</li>
						))}
					</ul>
				</div>
			)}

			{queue && queue.length > 0 && (
				<div className="queue-section">
					<h3 className="heading">DJ Queue Controls</h3>
					<div className="queue-scroll">
						<ul className="list-unstyled">
							{queue
								.filter(item => !playedSongs.includes(item.uri))
								.map((item, idx) => (
									<li key={idx} className="queue-item">
										<div className="queue-item-content">
											<span className="queue-number">{idx + 1}.</span>
											<span className="queue-track">{trackNames[item.uri] || 'Loading...'}</span>
											<span className="queue-added-by">dj {item.addedBy}</span>
										</div>
										<button
											className="button-remove"
											onClick={() => handleRemoveTrack(idx)}
											title="Remove track"
										>
											×
										</button>
									</li>
								))}
						</ul>
					</div>
				</div>
			)}
		</div>
	);
}

export default Controls;
