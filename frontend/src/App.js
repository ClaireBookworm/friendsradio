import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import queryString from 'query-string';
import axios from 'axios';
import Controls from './components/Controls';
import Player from './components/Player';
import Chat from './components/Chat';
import './index.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "https://friendsradio-production.up.railway.app";
const FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL || 'https://friends-radio.vercel.app';

// Styles object for reusable components
const styles = {
	container: {
		display: 'flex',
		height: '100vh',
		backgroundColor: '#0a0a0a',
		color: '#00ff9d',
		fontFamily: 'Monaco, Consolas, monospace',
		overflow: 'hidden',
		margin: '0',
		padding: '0'
	},
	column: {
		flex: 1,
		padding: '1.5rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '1rem',
		height: '100%',
		overflow: 'hidden'
	},
	divider: {
		borderRight: '1px solid #00ff9d33',
		margin: '0 2px'
	},
	heading: {
		fontSize: '1.5rem',
		marginBottom: '1rem',
		fontWeight: 'normal',
		borderBottom: '1px solid #00ff9d33',
		paddingBottom: '0.5rem'
	},
	connectionStatus: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.5rem',
		padding: '0.5rem 1rem',
		borderRadius: '4px',
		fontSize: '0.9rem',
		backgroundColor: '#00000050',
		border: '1px solid',
		transition: 'all 0.3s ease'
	},
	button: {
		backgroundColor: '#00ff9d15',
		color: '#00ff9d',
		border: '1px solid #00ff9d33',
		padding: '0.6rem 1.2rem',
		borderRadius: '4px',
		cursor: 'pointer',
		transition: 'all 0.2s ease',
		fontSize: '0.9rem',
		'&:hover': {
			backgroundColor: '#00ff9d25',
			borderColor: '#00ff9d'
		},
		'&:disabled': {
			opacity: 0.5,
			cursor: 'not-allowed'
		}
	},
	input: {
		backgroundColor: '#00000050',
		border: '1px solid #00ff9d33',
		color: '#00ff9d',
		padding: '0.5rem',
		borderRadius: '4px',
		marginBottom: '0.5rem',
		width: '100%',
		maxWidth: '300px'
	},
	queueList: {
		backgroundColor: '#00000030',
		borderRadius: '6px',
		padding: '1rem',
		marginTop: '0.5rem',
		maxHeight: '30vh',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column'
	},
	queueScroll: {
		overflowY: 'auto',
		flex: 1,
		'&::-webkit-scrollbar': {
			width: '8px'
		},
		'&::-webkit-scrollbar-track': {
			background: '#00000030'
		},
		'&::-webkit-scrollbar-thumb': {
			background: '#00ff9d33',
			borderRadius: '4px'
		}
	},
	queueItem: {
		padding: '0.5rem',
		borderBottom: '1px solid #00ff9d15',
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		'&:last-child': {
			borderBottom: 'none'
		}
	}
};

// A small component for displaying the queued tracks
function QueueList({ queue, accessToken }) {
	const [trackNames, setTrackNames] = useState({});

	// Function to get track name from Spotify
	const getTrackName = async (uri) => {
		if (!uri) return '';
		const trackId = uri.split(':')[2]; // Extract ID from spotify:track:ID
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
								<div>
									<span className="text-muted">{idx + 1}. </span>
									<strong>{trackNames[item.uri] || 'Loading...'}</strong>
									<span className="text-muted text-sm">
									&nbsp; | added by {item.addedBy}
									</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function App() {
	// Socket for real-time chat + queue updates
	const [socket] = React.useState(() => io(BACKEND_URL, {
		withCredentials: true,
		transports: ['websocket', 'polling'],
		extraHeaders: {
			"Access-Control-Allow-Origin": "*"
		}
	}));
 
	// Spotify tokens (for "listening along")
	const [accessToken, setAccessToken] = useState('');
	const [refreshToken, setRefreshToken] = useState('');
	const [spotifyUsername, setSpotifyUsername] = useState('');

	// DJ token (for controlling playback / adding tracks)
	const [djToken, setDjToken] = useState(null);
	const [djName, setDjName] = useState('');

	// Simple local states for DJ login form
	const [showDjLogin, setShowDjLogin] = useState(false);
	const [djLoginUsername, setDjLoginUsername] = useState('');
	const [djLoginPassword, setDjLoginPassword] = useState('');

	// Track queue
	const [queue, setQueue] = useState([]);
	const [isConnected, setIsConnected] = useState(false);

	// For adding new items to queue
	const [trackUri, setTrackUri] = useState('');
	const [deviceId, setDeviceId] = useState('');

	/**
	 * Socket connection and queue sync
	 */
	useEffect(() => {
		// Handle connection
		socket.on('connect', () => {
			console.log('Connected to server');
			setIsConnected(true);
		});

		// Handle disconnection
		socket.on('disconnect', () => {
			console.log('Disconnected from server');
			setIsConnected(false);
		});

		// Listen for queue updates
		socket.on('queueUpdated', (serverQueue) => {
			console.log('Received server queue:', serverQueue);
			setQueue(serverQueue);
		});

		return () => {
			socket.off('connect');
			socket.off('disconnect');
			socket.off('queueUpdated');
		};
	}, [socket]);

	/** 
	 * 1) On mount, parse any ?access_token / ?refresh_token from the URL 
	 *    (after Spotify OAuth redirects back).
	 */
	useEffect(() => {
		const parsed = queryString.parse(window.location.search);
		console.log('URL params:', parsed);
		
		// Check localStorage first
		const storedAccessToken = localStorage.getItem('spotify_access_token');
		const storedRefreshToken = localStorage.getItem('spotify_refresh_token');
		
		if (storedAccessToken) {
			console.log('Found stored tokens');
			setAccessToken(storedAccessToken);
			setRefreshToken(storedRefreshToken);
			fetchSpotifyProfile(storedAccessToken);
		}
		// If we have a code, exchange it for tokens
		else if (parsed.code) {
			console.log('Received code, exchanging for tokens...');
			axios.post(`${BACKEND_URL}/spotify/callback`, {
				code: parsed.code
			})
			.then(response => {
				console.log('Token exchange successful:', response.data);
				setAccessToken(response.data.access_token);
				setRefreshToken(response.data.refresh_token);
				// Store tokens in localStorage
				localStorage.setItem('spotify_access_token', response.data.access_token);
				localStorage.setItem('spotify_refresh_token', response.data.refresh_token);
				// Clear the URL parameters
				window.history.replaceState({}, document.title, window.location.pathname);
				// Fetch user profile
				fetchSpotifyProfile(response.data.access_token);
			})
			.catch(error => {
				console.error('Error exchanging code for tokens:', error);
			});
		}
		// If we already have tokens in the URL, use them
		else if (parsed.access_token) {
			console.log('Received tokens directly');
			setAccessToken(parsed.access_token);
			setRefreshToken(parsed.refresh_token);
			// Store tokens in localStorage
			localStorage.setItem('spotify_access_token', parsed.access_token);
			localStorage.setItem('spotify_refresh_token', parsed.refresh_token);
			// Clear the URL parameters
			window.history.replaceState({}, document.title, window.location.pathname);
			// Fetch user profile
			fetchSpotifyProfile(parsed.access_token);
		}
	}, []);

	// Add token refresh logic
	useEffect(() => {
		if (!refreshToken) return;

		const refreshInterval = setInterval(async () => {
			try {
				const response = await axios.get(`${BACKEND_URL}/spotify/refresh_token?refresh_token=${refreshToken}`);
				const newAccessToken = response.data.access_token;
				setAccessToken(newAccessToken);
				localStorage.setItem('spotify_access_token', newAccessToken);
			} catch (error) {
				console.error('Error refreshing token:', error);
			}
		}, 50 * 60 * 1000);

		return () => clearInterval(refreshInterval);
	}, [refreshToken]);

	// Function to fetch Spotify user profile
	const fetchSpotifyProfile = async (token) => {
		try {
			const response = await axios.get('https://api.spotify.com/v1/me', {
				headers: {
					Authorization: `Bearer ${token}`
				}
			});
			setSpotifyUsername(response.data.display_name || response.data.id);
		} catch (error) {
			console.error('Error fetching Spotify profile:', error);
		}
	};

	/**
	 * DJ login flow:
	 *  - POST to /auth/dj-login with {username, password}
	 *  - If correct, returns { token, username }
	 */
	const handleDjLogin = async () => {
		try {
			const resp = await axios.post(`${BACKEND_URL}/auth/dj-login`, 
				{
					username: djLoginUsername,
					password: djLoginPassword
				},
				{
					withCredentials: true,
					headers: {
						'Content-Type': 'application/json'
					}
				}
			);
			setDjToken(resp.data.token);
			setDjName(resp.data.username);
			setShowDjLogin(false);
		} catch (err) {
			console.error('DJ login error:', err?.response?.data || err);
			console.log('DJ login failed');
		}
	};
	/**
	 * Skip track (DJ-only)
	 */
	const handleSkip = async () => {
		if (!djToken) return alert('You must be the DJ to skip!');
		try {
			await axios.post(`${BACKEND_URL}/spotify/skip`, {
				djToken,
				accessToken,
				deviceId
			});
		} catch (err) {
			console.error('Skip track error:', err);
			alert('Failed to skip track');
		}
	};

	const handleDisconnectSpotify = () => {
		// Clear tokens from localStorage
		localStorage.removeItem('spotify_access_token');
		localStorage.removeItem('spotify_refresh_token');
		
		// Reset state
		setAccessToken('');
		setRefreshToken('');
		setSpotifyUsername('');
		setDeviceId('');
	};

	return (
		<div className="app-container">
			{/* LEFT COLUMN: Chat */}
			<div className="column">
				<h2 className="heading">Live Chat</h2>
				<Chat socket={socket} spotifyUsername={spotifyUsername} />
			</div>

			<div className="divider" />

			{/* RIGHT COLUMN: Spotify / DJ / Queue */}
			<div className="column">
				<h2 className="heading">Music & Controls</h2>

				{/* Connection Status */}
				<div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
					<span 
						className="status-dot"
						style={{ backgroundColor: isConnected ? 'var(--color-primary)' : 'var(--color-error)' }}
					/>
					{isConnected ? 'Connected' : 'Disconnected'}
				</div>

				{/* Spotify Auth Section */}
				{!accessToken ? (
					<div className="auth-section">
						<p>Want to listen in with your own Spotify? Click below to authorize:</p>
						<a href={`${BACKEND_URL}/spotify/login`} className="button">
							Connect Spotify
						</a>
					</div>
				) : (
					<div className="card spotify-status">
						<div className="spotify-info">
							<p>Connected as: <strong>{spotifyUsername}</strong></p>
						</div>
						<button 
							onClick={handleDisconnectSpotify}
							className="button button-danger"
						>
							Disconnect Spotify
						</button>
					</div>
				)}

				{/* DJ Login Section */}
				{!djToken ? (
					<div className="auth-section">
						<button 
							onClick={() => setShowDjLogin(!showDjLogin)}
							className="button"
						>
							{showDjLogin ? '← Cancel DJ Login' : 'Log in as DJ'}
						</button>
						
						{showDjLogin && (
							<div className="dj-login-form">
								<div className="form-group">
									<label>Username</label>
									<input
										className="input"
										value={djLoginUsername}
										onChange={(e) => setDjLoginUsername(e.target.value)}
										placeholder="Enter DJ username"
									/>
								</div>
								<div className="form-group">
									<label>Room Password</label>
									<input
										className="input"
										type="password"
										value={djLoginPassword}
										onChange={(e) => setDjLoginPassword(e.target.value)}
										placeholder="Enter room password"
									/>
								</div>
								<button 
									onClick={handleDjLogin}
									className="button"
								>
									Login as DJ
								</button>
							</div>
						)}
					</div>
				) : (
					<div className="card">
						<p>DJ Mode Active - <strong>{djName}</strong></p>
					</div>
				)}

				{/* Queue and Player Section */}
				{!djToken && <QueueList queue={queue} accessToken={accessToken} />}
				
				<Player 
					accessToken={accessToken} 
					djToken={djToken} 
					onDeviceIdChange={setDeviceId}
					socket={socket}
				/>

				{djToken && (
					<div className="player-section">
						<Controls
							socket={socket}
							djToken={djToken}
							accessToken={accessToken}
							deviceId={deviceId}
							queue={queue}
							setQueue={setQueue}
						/>

						<button 
							onClick={handleSkip} 
							className={`button ${!deviceId ? 'disabled' : ''}`}
							disabled={!deviceId}
						>
							Skip Track
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

export default App;
