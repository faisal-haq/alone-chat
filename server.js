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

// Track connected users by IP address (one IP = one person)
let usersByIP = new Map(); // ip -> { socket, mode }
let allIPs = new Set();
let waitingVideoUsers = [];
let waitingTextUsers = [];

// Get client IP from socket
function getClientIP(socket) {
  // Check for forwarded header (if behind proxy)
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address;
}

// Broadcast user count to all connected clients
function broadcastUserCount() {
  const count = allIPs.size;
  io.emit('user-count', { count: count });
  console.log(`Live users (by IP): ${count}`);
}

io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);
  console.log('User connected:', socket.id, 'IP:', clientIP);
  
  // Only count unique IPs (one IP = one person)
  if (!usersByIP.has(clientIP)) {
    allIPs.add(clientIP);
  }
  usersByIP.set(clientIP, { socket: socket, mode: null });
  broadcastUserCount();
  
  let currentMode = null;

socket.on('join', (data = {}) => {
    currentMode = data.mode || 'video';
    socket.mode = currentMode;
    
    // Update user IP record
    const ipData = usersByIP.get(clientIP);
    if (ipData) {
      ipData.mode = currentMode;
    }
    
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
  const clientIP = getClientIP(socket);
  console.log('User disconnected:', socket.id, 'IP:', clientIP);
  
  // Remove from IP tracking
  usersByIP.delete(clientIP);
  allIPs.delete(clientIP);
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

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`Production mode - HTTPS enabled`);
  } else {
    console.log(`Access at: http://localhost:${PORT}`);
  }
});
