import React, { useState, useEffect } from 'react';

function OnlineUsers({ socket }) {
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    // Listen for user list updates
    socket.on('users:update', (users) => {
      setOnlineUsers(users);
    });

    return () => {
      socket.off('users:update');
    };
  }, [socket]);

  return (
    <div className="online-users">
      <h3 className="heading">Online Users ({onlineUsers.length})</h3>
      <div className="users-list">
        {onlineUsers.length === 0 ? (
          <p className="text-muted">No users connected</p>
        ) : (
          <ul className="list-unstyled">
            {onlineUsers.map((username, idx) => (
              <li key={idx} className="user-item">
                <span className="status-dot" />
                {username}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OnlineUsers; 