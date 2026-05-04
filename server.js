const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname)));

let waitingVideoUsers = [];
let waitingTextUsers = [];

function removeFromWaiting(socket) {
  waitingVideoUsers = waitingVideoUsers.filter(s => s.id !== socket.id);
  waitingTextUsers = waitingTextUsers.filter(s => s.id !== socket.id);
}

function findMatch(socket, mode) {
  const list = mode === 'video' ? waitingVideoUsers : waitingTextUsers;
  removeFromWaiting(socket);

  if (list.length > 0) {
    const partner = list.shift();
    socket.partner = partner;
    partner.partner = socket;

    socket.emit('matched', { partnerId: partner.id });
    partner.emit('matched', { partnerId: socket.id });
  } else {
    list.push(socket);
    socket.emit('waiting');
  }
}

io.on('connection', (socket) => {
  socket.on('join', (data = {}) => {
    socket.mode = data.mode || 'video';
    findMatch(socket, socket.mode);
  });

  socket.on('offer', (data) => {
    if (socket.partner) {
      socket.partner.emit('offer', { sdp: data.sdp, senderId: socket.id });
    }
  });

  socket.on('answer', (data) => {
    if (socket.partner) {
      socket.partner.emit('answer', { sdp: data.sdp, senderId: socket.id });
    }
  });

  socket.on('ice-candidate', (data) => {
    if (socket.partner) {
      socket.partner.emit('ice-candidate', { candidate: data.candidate });
    }
  });

  socket.on('next', () => {
    removeFromWaiting(socket);

    if (socket.partner) {
      const partner = socket.partner;
      socket.partner = null;
      partner.partner = null;
      partner.emit('partner-left');
    }

    findMatch(socket, socket.mode || 'video');
  });

  socket.on('disconnect', () => {
    removeFromWaiting(socket);

    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
