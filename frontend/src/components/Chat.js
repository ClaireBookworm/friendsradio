import React, { useState, useEffect, useRef } from 'react';

function Chat({ socket, spotifyUsername }) {
	const [messages, setMessages] = useState([]);
	const [newMessage, setNewMessage] = useState('');
	const messagesEndRef = useRef(null);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	};

	useEffect(() => {
		socket.on('chat message', (msg) => {
			setMessages(prev => [...prev, msg]);
		});

		return () => {
			socket.off('chat message');
		};
	}, [socket]);

	useEffect(() => {
		scrollToBottom();
	}, [messages]);

	const handleSubmit = (e) => {
		e.preventDefault();
		if (!newMessage.trim() || !spotifyUsername) return;

		const message = {
			text: newMessage.trim(),
			username: spotifyUsername,
			timestamp: new Date().toISOString()
		};

		socket.emit('chat message', message);
		setNewMessage('');
	};

	const formatTimestamp = (timestamp) => {
		return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	};

	return (
		<div className="chat-container">
			<div className="messages-container">
				{messages.map((msg, idx) => (
					<div key={idx} className="message">
						<span className="username">{msg.username}:</span>
						<span>{msg.text}</span>
						<span className="timestamp">{formatTimestamp(msg.timestamp)}</span>
					</div>
				))}
				<div ref={messagesEndRef} />
			</div>
			
			<form onSubmit={handleSubmit} className="input-container">
				<input
					className="input"
					value={newMessage}
					onChange={(e) => setNewMessage(e.target.value)}
					placeholder={spotifyUsername ? "Type a message..." : "Connect Spotify to chat"}
					disabled={!spotifyUsername}
				/>
				<button 
					type="submit" 
					className={`button ${!spotifyUsername ? 'disabled' : ''}`}
					disabled={!spotifyUsername}
				>
					Send
				</button>
			</form>
		</div>
	);
}

export default Chat;
