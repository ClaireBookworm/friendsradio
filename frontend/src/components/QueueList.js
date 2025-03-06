import React, { useEffect, useState } from 'react';

function QueueList({ socket }) {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    socket.on('queueUpdated', (newQueue) => {
      setQueue(newQueue);
    });
    return () => {
      socket.off('queueUpdated');
    };
  }, [socket]);

  return (
    <div>
      <h2>Current Queue</h2>
      <ul>
        {queue.map((item, index) => (
          <li key={index}>
            {item.uri} (added by {item.addedBy})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default QueueList;
