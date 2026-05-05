const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname)));

// --- IP Ban System ---
const BAN_FILE = path.join(__dirname, 'banned_ips.json');

function loadBannedIPs() {
  try {
    if (fs.existsSync(BAN_FILE)) {
      const data = JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'));
      return new Set(data);
    }
  } catch(e) { console.error('Error loading bans:', e); }
  return new Set();
}

function saveBannedIPs() {
  try {
    fs.writeFileSync(BAN_FILE, JSON.stringify([...bannedIPs]), 'utf8');
  } catch(e) { console.error('Error saving bans:', e); }
}

let bannedIPs = loadBannedIPs();

function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return socket.handshake.address;
}

function banIP(ip) {
  bannedIPs.add(ip);
  saveBannedIPs();
  console.log(`Banned IP: ${ip} | Total bans: ${bannedIPs.size}`);
  // Kick all sockets with this IP
  io.sockets.sockets.forEach(s => {
    if (getClientIP(s) === ip) {
      s.emit('banned');
      s.disconnect(true);
    }
  });
}

// --- State ---
let waitingVideoUsers = [];
let waitingTextUsers  = [];
let onlineCount = 0;
// Track report counts: ip -> { count, reporters: Set of reporter socket ids }
let reportCounts = new Map();
const REPORTS_TO_BAN = 5; // number of reports needed to ban

function broadcastUserCount() {
  io.emit('user-count', { count: onlineCount });
}

function removeFromWaiting(socket) {
  waitingVideoUsers = waitingVideoUsers.filter(s => s.id !== socket.id);
  waitingTextUsers  = waitingTextUsers.filter(s => s.id !== socket.id);
}

function clearPartner(socket) {
  if (socket.partner) {
    socket.partner.partner = null;
    socket.partner = null;
  }
  socket.sessionId = null;
}

function matchSockets(a, b, commonInterests = []) {
  const sessionId = `${a.id}-${b.id}-${Date.now()}`;
  a.partner   = b;
  b.partner   = a;
  a.sessionId = sessionId;
  b.sessionId = sessionId;
  a.emit('matched', { partnerId: b.id, sessionId, commonInterests });
  b.emit('matched', { partnerId: a.id, sessionId, commonInterests });
  console.log(`Matched: ${a.id} <-> ${b.id} | Common: [${commonInterests.join(', ')}]`);
}

function getCommonInterests(a, b) {
  const aInterests = (a.interests || []).map(i => i.toLowerCase().trim());
  const bInterests = (b.interests || []).map(i => i.toLowerCase().trim());
  return aInterests.filter(i => i && bInterests.includes(i));
}

function findAndMatch(socket) {
  const mode = socket.mode || 'video';
  const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;
  const candidates = waitingList.filter(s => s.id !== socket.id && !s.partner);

  if (candidates.length === 0) {
    removeFromWaiting(socket);
    if (mode === 'video') waitingVideoUsers.push(socket);
    else                  waitingTextUsers.push(socket);
    socket.emit('waiting');
    return;
  }

  // Try to find a partner with at least one common interest
  let bestMatch = null;
  let bestCount = 0;

  if ((socket.interests || []).length > 0) {
    for (const candidate of candidates) {
      const common = getCommonInterests(socket, candidate);
      if (common.length > bestCount) {
        bestCount = common.length;
        bestMatch = candidate;
      }
    }
  }

  // Fall back to anyone if no interest match found
  const partner = bestMatch || candidates[0];
  const idx = waitingList.indexOf(partner);
  if (idx !== -1) waitingList.splice(idx, 1);

  const commonInterests = getCommonInterests(socket, partner);
  matchSockets(socket, partner, commonInterests);
}

function isValidSignal(socket, targetId) {
  return socket.partner && socket.partner.id === targetId;
}

// ---- Socket handlers ----
io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);

  // Check ban on connect
  if (bannedIPs.has(clientIP)) {
    socket.emit('banned');
    socket.disconnect(true);
    return;
  }

  socket.clientIP  = clientIP;
  socket.partner   = null;
  socket.sessionId = null;
  socket.mode      = 'video';

  onlineCount++;
  broadcastUserCount();
  console.log('Connected:', socket.id, 'IP:', clientIP, '| Online:', onlineCount);

  // ---- join ----
  socket.on('join', (data = {}) => {
    socket.mode      = data.mode || 'video';
    socket.interests = Array.isArray(data.interests) ? data.interests : [];
    if (socket.partner) {
      socket.partner.emit('partner-left');
      clearPartner(socket);
    }
    removeFromWaiting(socket);
    findAndMatch(socket);
  });

  // ---- next ----
  socket.on('next', () => {
    if (socket.partner && socket.partner.partner && socket.partner.partner.id === socket.id) {
      socket.partner.emit('partner-left');
    }
    clearPartner(socket);
    removeFromWaiting(socket);
    findAndMatch(socket);
  });

  // ---- stop ----
  socket.on('stop', () => {
    if (socket.partner && socket.partner.partner && socket.partner.partner.id === socket.id) {
      socket.partner.emit('partner-left');
      socket.partner.partner   = null;
      socket.partner.sessionId = null;
    }
    clearPartner(socket);
    removeFromWaiting(socket);
  });

  // ---- REPORT ----
  socket.on('report', (data) => {
    const reportedId = data.reportedId;

    // Must have a current partner and it must match reportedId
    if (!reportedId || !socket.partner || socket.partner.id !== reportedId) {
      socket.emit('report-ack', { message: 'No active user to report.' });
      return;
    }

    const reportedSocket = socket.partner;
    const reportedIP = reportedSocket.clientIP;
    const reporterIP = socket.clientIP;

    if (!reportedIP) return;

    // Step 1: Always disconnect reported user from chat immediately
    // Save reference before clearPartner nulls it
    const reporterSocket = socket;
    if (reportedSocket.partner) {
      reportedSocket.emit('kicked');   // tell reported user they were kicked
      clearPartner(reportedSocket);
      clearPartner(reporterSocket);
      removeFromWaiting(reportedSocket);
      removeFromWaiting(reporterSocket);
      // Reporter goes back to finding new partner
      reporterSocket.emit('report-ack', { message: 'User reported and disconnected.' });
      findAndMatch(reporterSocket);
    }

    // Step 2: Track report count (use socket ID as key to support local testing)
    // Use reportedSocket.id as unique key so same-IP local testing still works
    const trackKey = reportedSocket.id;
    if (!reportCounts.has(trackKey)) {
      reportCounts.set(trackKey, { count: 0, reporters: new Set(), ip: reportedIP });
    }
    const record = reportCounts.get(trackKey);

    if (!record.reporters.has(reporterSocket.id)) {
      record.reporters.add(reporterSocket.id);
      record.count++;
    }
    console.log(`Report against ${trackKey} (IP:${reportedIP}): ${record.count}/${REPORTS_TO_BAN}`);

    // Step 3: Ban IP if threshold reached
    if (record.count >= REPORTS_TO_BAN) {
      reportCounts.delete(trackKey);
      banIP(reportedIP);
    }
  });

  // ---- WebRTC signaling ----
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
