const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname)));

let waitingVideoUsers = [];
let waitingTextUsers = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentMode = null;

  socket.on('join', (data = {}) => {
    currentMode = data.mode || 'video';
    socket.mode = currentMode;
    
    if (currentMode === 'video') {
      if (waitingVideoUsers.length > 0) {
        const partner = waitingVideoUsers.pop();
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingVideoUsers.push(socket);
        socket.emit('waiting');
      }
    } else {
      if (waitingTextUsers.length > 0) {
        const partner = waitingTextUsers.pop();
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingTextUsers.push(socket);
        socket.emit('waiting');
      }
    }
  });

  socket.on('offer', (data) => {
    if (socket.partner) {
      socket.partner.emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    if (socket.partner) {
      socket.partner.emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data) => {
    if (socket.partner) {
      socket.partner.emit('ice-candidate', data);
    }
  });

  socket.on('message', (data) => {
    if (socket.partner) {
      socket.partner.emit('message', data);
    }
  });

  socket.on('next', () => {
    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
      socket.partner = null;
    }
    
    const mode = socket.mode || 'video';
    if (mode === 'video') {
      if (waitingVideoUsers.length > 0) {
        const partner = waitingVideoUsers.pop();
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingVideoUsers.push(socket);
        socket.emit('waiting');
      }
    } else {
      if (waitingTextUsers.length > 0) {
        const partner = waitingTextUsers.pop();
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingTextUsers.push(socket);
        socket.emit('waiting');
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.partner) {
      socket.partner.emit('partner-left');
      socket.partner.partner = null;
    }
    
    const mode = socket.mode || 'video';
    const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;
    const index = waitingList.indexOf(socket);
    if (index > -1) {
      waitingList.splice(index, 1);
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`Production mode - HTTPS enabled`);
  } else {
    console.log(`Access at: http://localhost:${PORT}`);
  }
});
