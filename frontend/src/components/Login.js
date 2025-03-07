import React, { useState } from 'react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000'; // 'https://friendsradio-production.up.railway.app';

function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      const resp = await axios.post(`${BACKEND_URL}/auth/dj-login`, {
        username,
        password
      });
      // resp.data => { token, username }
      onLoginSuccess(resp.data.token, resp.data.username);
    } catch (error) {
      console.error('Login error:', error);
      alert(error?.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div style={{ padding: '1rem' }}>
      <h2>Enter Room</h2>
      <div>
        <label>Username: </label>
        <input value={username} onChange={e => setUsername(e.target.value)} />
      </div>

      <div>
        <label>Password: </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
      </div>

      <button onClick={handleLogin}>Join</button>
    </div>
  );
}

export default Login;
