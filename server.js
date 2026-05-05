const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname)));

// --- State ---
let waitingVideoUsers = []; // sockets waiting for a video partner
let waitingTextUsers  = []; // sockets waiting for a text partner
let onlineCount = 0;

function broadcastUserCount() {
  io.emit('user-count', { count: onlineCount });
}

// Remove a socket from both waiting lists (safety helper)
function removeFromWaiting(socket) {
  waitingVideoUsers = waitingVideoUsers.filter(s => s.id !== socket.id);
  waitingTextUsers  = waitingTextUsers.filter(s => s.id !== socket.id);
}

// Cleanly dissolve partnership for ONE side only, without triggering the other
function clearPartner(socket) {
  if (socket.partner) {
    socket.partner.partner = null;
    socket.partner = null;
  }
  // Also clear the session token so stale WebRTC signals are dropped
  socket.sessionId = null;
}

// Match two sockets and assign a shared sessionId so signals can be validated
function matchSockets(a, b) {
  const sessionId = `${a.id}-${b.id}-${Date.now()}`;
  a.partner   = b;
  b.partner   = a;
  a.sessionId = sessionId;
  b.sessionId = sessionId;

  a.emit('matched', { partnerId: b.id, sessionId });
  b.emit('matched', { partnerId: a.id, sessionId });
  console.log(`Matched: ${a.id} <-> ${b.id}  session:${sessionId}`);
}

function findAndMatch(socket) {
  const mode = socket.mode || 'video';
  const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;

  // Pick first waiting socket that is NOT this socket and has NO partner already
  const idx = waitingList.findIndex(s => s.id !== socket.id && !s.partner);

  if (idx !== -1) {
    const partner = waitingList.splice(idx, 1)[0]; // remove from waiting
    matchSockets(socket, partner);
  } else {
    // Make sure we're not already in the list before pushing
    removeFromWaiting(socket);
    if (mode === 'video') waitingVideoUsers.push(socket);
    else                  waitingTextUsers.push(socket);
    socket.emit('waiting');
  }
}

// Validate that an incoming signal belongs to the current session
function isValidSignal(socket, targetId) {
  return (
    socket.partner &&
    socket.partner.id === targetId
  );
}

// ---- Socket handlers ----
io.on('connection', (socket) => {
  onlineCount++;
  broadcastUserCount();
  console.log('Connected:', socket.id, '| Online:', onlineCount);

  socket.partner   = null;
  socket.sessionId = null;
  socket.mode      = 'video';

  // ---- join ----
  socket.on('join', (data = {}) => {
    socket.mode = data.mode || 'video';

    // Clean up any previous partnership
    if (socket.partner) {
      socket.partner.emit('partner-left');
      clearPartner(socket);
    }
    removeFromWaiting(socket);

    findAndMatch(socket);
  });

  // ---- next ----
  socket.on('next', () => {
    // Notify OLD partner they were left — but only if they are still paired with US
    if (socket.partner && socket.partner.partner && socket.partner.partner.id === socket.id) {
      socket.partner.emit('partner-left');
    }
    clearPartner(socket);
    removeFromWaiting(socket);

    findAndMatch(socket);
  });

  // ---- WebRTC signaling — all validated against current partner + session ----
  socket.on('offer', (data) => {
    if (!isValidSignal(socket, data.targetId)) return;
    socket.partner.emit('offer', { sdp: data.sdp, senderId: socket.id });
  });

  socket.on('answer', (data) => {
    if (!isValidSignal(socket, data.targetId)) return;
    socket.partner.emit('answer', { sdp: data.sdp, senderId: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    if (!isValidSignal(socket, data.targetId)) return;
    socket.partner.emit('ice-candidate', { candidate: data.candidate, senderId: socket.id });
  });

  // ---- chat message ----
  socket.on('message', (data) => {
    if (socket.partner) socket.partner.emit('message', data);
  });

  // ---- disconnect ----
  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastUserCount();
    console.log('Disconnected:', socket.id, '| Online:', onlineCount);

    // Notify partner but only if they're still paired with this socket
    if (socket.partner && socket.partner.partner && socket.partner.partner.id === socket.id) {
      socket.partner.emit('partner-left');
      socket.partner.partner   = null;
      socket.partner.sessionId = null;
    }

    removeFromWaiting(socket);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
