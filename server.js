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

// Track connected users and their modes
let allUsers = new Set();
let waitingVideoUsers = [];
let waitingTextUsers = [];

// Broadcast user count to all connected clients
function broadcastUserCount() {
  const count = allUsers.size;
  io.emit('user-count', { count: count });
  console.log(`Live users: ${count}`);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  allUsers.add(socket.id);
  broadcastUserCount();
  
  let currentMode = null;

socket.on('join', (data = {}) => {
    currentMode = data.mode || 'video';
    socket.mode = currentMode;
    
    // Find a partner - but NOT yourself!
    let partner = null;
    
    if (currentMode === 'video') {
      // Find a partner from waiting list who is NOT yourself
      const candidates = waitingVideoUsers.filter(c => c.id !== socket.id);
      
      if (candidates.length > 0) {
        partner = candidates[0];
        // Remove this partner from waiting list
        const idx = waitingVideoUsers.indexOf(partner);
        if (idx > -1) waitingVideoUsers.splice(idx, 1);
      }
      
      if (partner) {
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingVideoUsers.push(socket);
        socket.emit('waiting');
      }
    } else {
      // Find a partner from waiting list who is NOT yourself
      const candidates = waitingTextUsers.filter(c => c.id !== socket.id);
      
      if (candidates.length > 0) {
        partner = candidates[0];
        // Remove this partner from waiting list
        const idx = waitingTextUsers.indexOf(partner);
        if (idx > -1) waitingTextUsers.splice(idx, 1);
      }
      
      if (partner) {
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
    // Only send offer to the partner, not yourself
    if (socket.partner && data.targetId === socket.partner.id) {
      socket.partner.emit('offer', { sdp: data.sdp, senderId: socket.id });
    }
  });

  socket.on('answer', (data) => {
    // Only send answer to the partner, not yourself
    if (socket.partner && data.targetId === socket.partner.id) {
      socket.partner.emit('answer', { sdp: data.sdp, senderId: socket.id });
    }
  });

  socket.on('ice-candidate', (data) => {
    // Only send ICE candidate to the partner, not yourself
    if (socket.partner && data.targetId === socket.partner.id) {
      socket.partner.emit('ice-candidate', { candidate: data.candidate, senderId: socket.id });
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
      // Find a partner who is NOT yourself
      const candidates = waitingVideoUsers.filter(c => c.id !== socket.id);
      
      if (candidates.length > 0) {
        const partner = candidates[0];
        const idx = waitingVideoUsers.indexOf(partner);
        if (idx > -1) waitingVideoUsers.splice(idx, 1);
        
        socket.partner = partner;
        partner.partner = socket;

        socket.emit('matched', { partnerId: partner.id });
        partner.emit('matched', { partnerId: socket.id });
      } else {
        waitingVideoUsers.push(socket);
        socket.emit('waiting');
      }
    } else {
      // Find a partner who is NOT yourself
      const candidates = waitingTextUsers.filter(c => c.id !== socket.id);
      
      if (candidates.length > 0) {
        const partner = candidates[0];
        const idx = waitingTextUsers.indexOf(partner);
        if (idx > -1) waitingTextUsers.splice(idx, 1);
        
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
    allUsers.delete(socket.id);
    broadcastUserCount();
    
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
