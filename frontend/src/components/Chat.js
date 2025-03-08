import React, { useState, useEffect, useRef } from 'react';

function Chat({ socket, spotifyUsername }) {
	const [messages, setMessages] = useState([]);
	const [inputMessage, setInputMessage] = useState('');
	const messagesEndRef = useRef(null);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	useEffect(() => {
		// Scroll to bottom whenever messages change
		scrollToBottom();
	}, [messages]);

	useEffect(() => {
		socket.on('chat message', (message) => {
			setMessages(prev => [...prev, message]);
		});

		return () => {
			socket.off('chat message');
		};
	}, [socket]);

	const handleSubmit = (e) => {
		e.preventDefault();
		if (!inputMessage.trim() || !spotifyUsername) return;

		const message = {
			text: inputMessage.trim(),
			username: spotifyUsername,
			timestamp: new Date().toISOString()
		};

		socket.emit('chat message', message);
		setInputMessage('');
	};

	const formatTimestamp = (timestamp) => {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	};

	return (
		<div className="chat-container">
			<div className="messages-container">
				{messages.map((msg, idx) => (
					<div key={idx} className="message">
						<span className="username">{msg.username}:</span>
						<span className="message-text">{msg.text}</span>
						<span className="timestamp">{formatTimestamp(msg.timestamp)}</span>
					</div>
				))}
				<div ref={messagesEndRef} />
			</div>
			<form onSubmit={handleSubmit} className="input-container">
				<input
					className="input"
					value={inputMessage}
					onChange={(e) => setInputMessage(e.target.value)}
					placeholder={spotifyUsername ? "Type a message..." : "Connect Spotify to chat"}
					disabled={!spotifyUsername}
				/>
				<button
					type="submit"
					className="button"
					disabled={!spotifyUsername || !inputMessage.trim()}
				>
					Send
				</button>
			</form>
		</div>
	);
}

export default Chat;
