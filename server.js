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
// Track report counts: ip -> { count, reporters: Set of reporter IPs }
let reportCounts = new Map();
const REPORTS_TO_BAN = 5; // number of reports needed to ban

// --- Friend Room System ---
// friendRooms: roomCode -> { members: [socket, ...], mode, interests, createdAt }
let friendRooms = new Map();
// waitingGroupRooms: array of room codes waiting to be matched with a stranger
let waitingGroupRooms = [];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function cleanupRoom(roomCode) {
  friendRooms.delete(roomCode);
  waitingGroupRooms = waitingGroupRooms.filter(c => c !== roomCode);
}

function getAvailableSoloStrangers(mode, directStranger = null) {
  const seen = new Set();
  const candidates = [];

  const addIfAvailable = (s) => {
    if (!s || seen.has(s.id)) return;
    if ((s.mode || 'video') !== mode) return;
    if (!s.isSearching) return;
    if (s.partner || s.friendRoomCode || s.groupSession) return;
    seen.add(s.id);
    candidates.push(s);
  };

  addIfAvailable(directStranger);
  (mode === 'video' ? waitingVideoUsers : waitingTextUsers).forEach(addIfAvailable);
  io.sockets.sockets.forEach(addIfAvailable);
  return candidates;
}

function findAndMatchGroup(roomCode, directStranger = null) {
  const room = friendRooms.get(roomCode);
  if (!room) return;
  if (room.members.length < 2) return;

  const mode = room.mode || 'video';
  const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;
  const f0 = room.members[0];
  const f1 = room.members[1];

  // Notify all members that searching has begun (so joiner can switch to group screen)
  room.members.forEach(m => m.emit('group-searching'));
  f0.groupSession = `room-${roomCode}`;
  f0.groupRole = 'friend';
  f0.groupPartners = [f1];
  f1.groupSession = `room-${roomCode}`;
  f1.groupRole = 'friend';
  f1.groupPartners = [f0];
  f0.emit('friend-preview-ready', { peer: { id: f1.id, slot: 0, isOfferer: f0.id < f1.id } });
  f1.emit('friend-preview-ready', { peer: { id: f0.id, slot: 0, isOfferer: f1.id < f0.id } });

  // Find a solo stranger waiting, or use the solo user that just joined while this room was queued.
  const candidates = getAvailableSoloStrangers(mode, directStranger);
  if (candidates.length === 0) {
    if (!waitingGroupRooms.includes(roomCode)) waitingGroupRooms.push(roomCode);
    room.members.forEach(m => m.emit('waiting'));
    return;
  }

  // Pick best stranger by interest match
  const roomInterests = room.interests || [];
  let bestStranger = candidates[0];
  let bestCount = 0;
  for (const c of candidates) {
    const cInterests = (c.interests || []).map(i => i.toLowerCase().trim());
    const common = roomInterests.filter(i => i && cInterests.includes(i));
    if (common.length > bestCount) { bestCount = common.length; bestStranger = c; }
  }

  // Remove stranger from waiting list
  const idx = waitingList.indexOf(bestStranger);
  if (idx !== -1) waitingList.splice(idx, 1);
  waitingGroupRooms = waitingGroupRooms.filter(c => c !== roomCode);

  // Build session
  const sessionId = `group-${roomCode}-${bestStranger.id}-${Date.now()}`;
  const commonInterests = roomInterests.filter(i => {
    const si = (bestStranger.interests || []).map(x => x.toLowerCase().trim());
    return i && si.includes(i);
  });

  const st = bestStranger;
  leaveSoloChat(st, false);
  st.isSearching = false;

  // Offerer rule: the peer whose socket.id is lexicographically SMALLER sends the offer.
  // Each socket gets an explicit peers array: [{id, slot, isOfferer}]
  // slot = which video box (0=left remote, 1=right remote) the peer's video goes into.

  f0.groupSession = sessionId; f0.groupRole = 'friend'; f0.groupPartners = [f1, st];
  f1.groupSession = sessionId; f1.groupRole = 'friend'; f1.groupPartners = [f0, st];
  st.groupSession = sessionId; st.groupRole = 'stranger'; st.groupPartners = [f0, f1];

  const payloads = [
    {
      socket: f0,
      data: {
        sessionId, role: 'friend', commonInterests,
        peers: [
          { id: f1.id, slot: 0, isOfferer: f0.id < f1.id },
          { id: st.id, slot: 1, isOfferer: f0.id < st.id }
        ]
      }
    },
    {
      socket: f1,
      data: {
        sessionId, role: 'friend', commonInterests,
        peers: [
          { id: f0.id, slot: 0, isOfferer: f1.id < f0.id },
          { id: st.id, slot: 1, isOfferer: f1.id < st.id }
        ]
      }
    },
    {
      socket: st,
      data: {
        sessionId, role: 'stranger', commonInterests,
        peers: [
          { id: f0.id, slot: 0, isOfferer: st.id < f0.id },
          { id: f1.id, slot: 1, isOfferer: st.id < f1.id }
        ]
      }
    }
  ];

  payloads.forEach(({ socket: participant, data }) => participant.emit('group-matched', data));

  console.log(`Group matched: f0:${f0.id} f1:${f1.id} stranger:${st.id}`);
}

function requeueGroupRoom(socket) {
  const code = socket.friendRoomCode;
  const room = code ? friendRooms.get(code) : null;

  if (!room || room.members.length < 2) {
    // Socket is a stranger (no friendRoomCode). Find the friend room that had this stranger
    // as a groupPartner and requeue it so friends get a new stranger automatically.
    const friendRoomCode = (() => {
      for (const [rc, r] of friendRooms) {
        if (r.members.some(m => (m.groupPartners || []).some(p => p.id === socket.id))) return rc;
      }
      return null;
    })();

    // Cleanly disconnect stranger from group state first
    socket.isSearching = true;
    clearGroupSession(socket);

    // Requeue the friend room BEFORE finding a solo match for the stranger.
    // This ensures the friend room is in waitingGroupRooms so future solo users
    // can be matched into it — but the stranger themselves must NOT be routed
    // back into a group room (they clicked "find new stranger" from solo intent).
    if (friendRoomCode) {
      const fr = friendRooms.get(friendRoomCode);
      if (fr && fr.members.length >= 2) {
        fr.members.forEach(member => {
          member.groupSession = 'room-' + friendRoomCode;
          member.groupRole = 'friend';
          member.groupPartners = [];
          member.friendRoomCode = friendRoomCode;
        });
        waitingGroupRooms = waitingGroupRooms.filter(c => c !== friendRoomCode);
        findAndMatchGroup(friendRoomCode);
      }
    }

    // FIX: use findAndMatchSoloOnly so the stranger is NOT matched back into
    // a group room (including the friends' room just re-queued above).
    // findAndMatch checks waitingGroupRooms first — on the same tick the friend
    // room may already be in that list, causing stranger to rejoin the same duo.
    findAndMatchSoloOnly(socket);
    return;
  }

  // Fully reset group session state for all current room members (friends + possibly stranger)
  // so stale `groupRole/groupPartners/groupSession` don't survive into the next match.
  // FIX: pass keepRoomCode=true so friendRoomCode is NOT nulled on friends — without this,
  // the second friend's next requeue call loses the room code and falls to solo findAndMatch.
  room.members.forEach(member => {
    // Notify peers that group partner is leaving (best-effort; clients will rebuild on group-matched)
    try {
      (member.groupPartners || []).forEach(p => {
        if (p && p.id !== member.id) p.emit('group-partner-left', { senderId: member.id });
      });
    } catch (e) {}

    member.groupSession = null;
    member.groupRole = null;
    member.groupPartners = [];
  });

  // If the current caller had a stranger attached, remove it from waiting tracking too.
  const oldPartners = socket.groupPartners || [];
  const stranger = oldPartners.find(p => p.groupRole === 'stranger');
  if (stranger) {
    try {
      stranger.emit('group-partner-left', { senderId: socket.id });
    } catch (e) {}
    stranger.groupSession = null;
    stranger.groupRole = null;
    stranger.groupPartners = [];
    stranger.friendRoomCode = null;
    removeFromWaiting(stranger);
  }

  // Re-seed friends' group-room linkage (no stranger yet)
  // Keep room.members as-is (2 friends max), but clear strangers if any accidentally got in.
  room.members = room.members.filter(m => m.id !== stranger?.id);

  room.members.forEach(member => {
    member.groupSession = `room-${code}`;
    member.groupRole = 'friend';
    // friends will be paired with a stranger by findAndMatchGroup()
    member.groupPartners = [];
    // FIX: ensure friendRoomCode stays set (may have been cleared by earlier clearGroupSession call)
    member.friendRoomCode = code;
  });

  waitingGroupRooms = waitingGroupRooms.filter(c => c !== code);
  findAndMatchGroup(code);
}

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

function leaveSoloChat(socket, notifyPartner = true) {
  if (socket.partner && socket.partner.partner && socket.partner.partner.id === socket.id) {
    if (notifyPartner) socket.partner.emit('partner-left');
    socket.partner.partner = null;
    socket.partner.sessionId = null;
  }
  clearPartner(socket);
  removeFromWaiting(socket);
}

function clearGroupSession(socket, notifyPartners = true, keepRoomCode = false) {
  const partners = socket.groupPartners || [];
  if (notifyPartners) {
    partners.forEach(p => {
      p.emit('group-partner-left', { senderId: socket.id });
      p.groupPartners = (p.groupPartners || []).filter(x => x.id !== socket.id);
    });
  }
  socket.groupSession = null;
  socket.groupRole = null;
  socket.groupPartners = [];
  // FIX: keepRoomCode=true used by requeueGroupRoom so friends stay in their room
  // after a stranger leaves. Without this, friendRoomCode gets nulled and the next
  // requeue call loses the room, falling back to solo findAndMatch.
  if (!keepRoomCode && socket.friendRoomCode) {
    const code = socket.friendRoomCode;
    const room = friendRooms.get(code);
    if (room) {
      room.members = room.members.filter(m => m.id !== socket.id);
      if (room.members.length === 0) cleanupRoom(code);
      else room.members.forEach(m => m.emit('room-member-update', { membersCount: room.members.length }));
    }
    socket.friendRoomCode = null;
  }
}

function matchSockets(a, b, commonInterests = []) {
  const sessionId = `${a.id}-${b.id}-${Date.now()}`;
  a.partner   = b;
  b.partner   = a;
  a.isSearching = false;
  b.isSearching = false;
  a.sessionId = sessionId;
  b.sessionId = sessionId;
  a.emit('matched', { partnerId: b.id, sessionId, commonInterests, isOfferer: a.id < b.id });
  b.emit('matched', { partnerId: a.id, sessionId, commonInterests, isOfferer: b.id < a.id });
  console.log(`Matched: ${a.id} <-> ${b.id} | Common: [${commonInterests.join(', ')}]`);
}

function getCommonInterests(a, b) {
  const aInterests = (a.interests || []).map(i => i.toLowerCase().trim());
  const bInterests = (b.interests || []).map(i => i.toLowerCase().trim());
  return aInterests.filter(i => i && bInterests.includes(i));
}

function findAndMatchSoloOnly(socket) {
  // Like findAndMatch but never routes into a group room.
  // Used when a stranger leaves a group session and wants a solo match.
  const mode = socket.mode || 'video';
  const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;

  const candidates = waitingList.filter(s => s.id !== socket.id && !s.partner && !s.groupSession);

  if (candidates.length === 0) {
    removeFromWaiting(socket);
    socket.isSearching = true;
    if (mode === 'video') waitingVideoUsers.push(socket);
    else                  waitingTextUsers.push(socket);
    socket.emit('waiting');
    return;
  }

  let bestMatch = null, bestCount = 0;
  if ((socket.interests || []).length > 0) {
    for (const candidate of candidates) {
      const common = getCommonInterests(socket, candidate);
      if (common.length > bestCount) { bestCount = common.length; bestMatch = candidate; }
    }
  }

  const partner = bestMatch || candidates[0];
  const idx = waitingList.indexOf(partner);
  if (idx !== -1) waitingList.splice(idx, 1);

  const commonInterests = getCommonInterests(socket, partner);
  matchSockets(socket, partner, commonInterests);
}

function findAndMatch(socket) {
  const mode = socket.mode || 'video';
  const waitingList = mode === 'video' ? waitingVideoUsers : waitingTextUsers;
  const waitingRoomCode = waitingGroupRooms.find(code => {
    const room = friendRooms.get(code);
    return room && room.members.length === 2 && (room.mode || 'video') === mode;
  });

  if (waitingRoomCode) {
    removeFromWaiting(socket);
    findAndMatchGroup(waitingRoomCode, socket);
    return;
  }

  const candidates = waitingList.filter(s => s.id !== socket.id && !s.partner);

  if (candidates.length === 0) {
    removeFromWaiting(socket);
    socket.isSearching = true;
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

function getReceiverGroupSlot(receiver, sender) {
  if (receiver.groupRole === 'stranger') {
    // FIX: findIndex returns -1 if partner not yet in groupPartners (race condition).
    // -1 causes getGroupSlotElements(-1) on client → undefined videoEl → silent fail.
    const idx = (receiver.groupPartners || []).findIndex(p => p.id === sender.id);
    return idx === -1 ? 0 : idx;
  }
  return sender.groupRole === 'stranger' ? 1 : 0;
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
  socket.groupSession = null;
  socket.groupRole    = null;
  socket.groupPartners = [];
  socket.friendRoomCode = null;
  socket.isSearching = false;

  onlineCount++;
  broadcastUserCount();
  console.log('Connected:', socket.id, 'IP:', clientIP, '| Online:', onlineCount);

  // ---- create-friend-room ----
  socket.on('create-friend-room', (data = {}) => {
    socket.isSearching = false;
    leaveSoloChat(socket);
    clearGroupSession(socket);
    // Leave any existing room
    if (socket.friendRoomCode) {
      const oldRoom = friendRooms.get(socket.friendRoomCode);
      if (oldRoom) {
        oldRoom.members = oldRoom.members.filter(m => m.id !== socket.id);
        if (oldRoom.members.length === 0) cleanupRoom(socket.friendRoomCode);
      }
    }
    let code;
    do { code = generateRoomCode(); } while (friendRooms.has(code));
    socket.friendRoomCode = code;
    socket.mode = data.mode || 'video';
    socket.interests = Array.isArray(data.interests) ? data.interests.map(i => i.toLowerCase().trim()) : [];
    friendRooms.set(code, {
      members: [socket],
      mode: socket.mode,
      interests: socket.interests,
      createdAt: Date.now()
    });
    socket.emit('room-created', { code });
    console.log(`Room created: ${code} by ${socket.id}`);
    // Auto-expire room after 10 min if not filled
    setTimeout(() => {
      const r = friendRooms.get(code);
      if (r && r.members.length < 2) {
        r.members.forEach(m => { m.emit('room-expired'); m.friendRoomCode = null; });
        cleanupRoom(code);
      }
    }, 10 * 60 * 1000);
  });

  // ---- join-friend-room ----
  socket.on('join-friend-room', (data = {}) => {
    const code = (data.code || '').toUpperCase().trim();
    const room = friendRooms.get(code);
    if (!room) { socket.emit('room-error', { message: 'Room not found. Check the code and try again.' }); return; }
    if (room.members.length >= 2) { socket.emit('room-error', { message: 'Room is full (2 friends max).' }); return; }
    if (room.members.find(m => m.id === socket.id)) { socket.emit('room-error', { message: 'You are already in this room.' }); return; }

    socket.isSearching = false;
    leaveSoloChat(socket);
    clearGroupSession(socket);
    socket.friendRoomCode = code;
    socket.mode = room.mode;
    socket.interests = Array.isArray(data.interests) ? data.interests.map(i => i.toLowerCase().trim()) : room.interests;
    room.members.push(socket);
    // Merge interests
    room.interests = [...new Set([...room.interests, ...socket.interests])];

    socket.emit('room-joined', { code, membersCount: room.members.length });
    room.members.forEach(m => m.emit('room-member-update', { membersCount: room.members.length }));
    console.log(`${socket.id} joined room ${code}. Members: ${room.members.length}`);

    if (room.members.length === 2) {
      room.members.forEach(m => m.emit('room-ready'));
    }
  });

  // ---- start-group-chat ---- (room leader triggers search)
  socket.on('start-group-chat', () => {
    const code = socket.friendRoomCode;
    if (!code) return;
    const room = friendRooms.get(code);
    if (!room || room.members.length < 2) { socket.emit('room-error', { message: 'Need 2 friends in room to start.' }); return; }
    findAndMatchGroup(code);
  });

  // ---- group signaling relay ----
  socket.on('group-offer', (data) => {
    const target = (socket.groupPartners || []).find(p => p.id === data.targetId);
    if (target) target.emit('group-offer', {
      sdp: data.sdp,
      senderId: socket.id,
      receiverSlot: getReceiverGroupSlot(target, socket)
    });
  });
  socket.on('group-answer', (data) => {
    const target = (socket.groupPartners || []).find(p => p.id === data.targetId);
    if (target) target.emit('group-answer', {
      sdp: data.sdp,
      senderId: socket.id,
      receiverSlot: getReceiverGroupSlot(target, socket)
    });
  });
  socket.on('group-ice', (data) => {
    const target = (socket.groupPartners || []).find(p => p.id === data.targetId);
    if (target) target.emit('group-ice', {
      candidate: data.candidate,
      senderId: socket.id,
      receiverSlot: getReceiverGroupSlot(target, socket)
    });
  });
  socket.on('group-message', (data) => {
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 1000) : '';
    if (!text) return;
    (socket.groupPartners || []).forEach(p => p.emit('group-message', { text, senderId: socket.id, role: socket.groupRole }));
  });
  socket.on('group-next', () => {
    requeueGroupRoom(socket);
  });

  // ---- join ----
  socket.on('join', (data = {}) => {
    socket.mode      = data.mode || 'video';
    socket.interests = Array.isArray(data.interests) ? data.interests.map(i => String(i).toLowerCase().trim()).filter(Boolean).slice(0, 20) : [];
    leaveSoloChat(socket);
    socket.isSearching = true;
    findAndMatch(socket);
  });

  // ---- next ----
  socket.on('next', () => {
    leaveSoloChat(socket);
    socket.isSearching = true;
    findAndMatch(socket);
  });

  // ---- stop ----
  socket.on('stop', () => {
    socket.isSearching = false;
    clearGroupSession(socket);
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

    // Step 2: Track report count per reported IP.
    const trackKey = reportedIP;
    if (!reportCounts.has(trackKey)) {
      reportCounts.set(trackKey, { count: 0, reporters: new Set(), ip: reportedIP });
    }
    const record = reportCounts.get(trackKey);

    if (!record.reporters.has(reporterIP)) {
      record.reporters.add(reporterIP);
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
    // Group cleanup
    clearGroupSession(socket);
    if (socket.friendRoomCode) {
      const room = friendRooms.get(socket.friendRoomCode);
      if (room) {
        room.members = room.members.filter(m => m.id !== socket.id);
        if (room.members.length === 0) cleanupRoom(socket.friendRoomCode);
        else room.members.forEach(m => m.emit('room-member-update', { membersCount: room.members.length }));
      }
    }
    removeFromWaiting(socket);
  });
});

const PORT = process.env.PORT || 3003;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
