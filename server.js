const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
// ── SEO: robots.txt & sitemap.xml ───────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: https://omefly.online/sitemap.xml');
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://omefly.online/</loc><priority>1.0</priority></url>
  <url><loc>https://omefly.online/omegle-alternative</loc><priority>0.9</priority></url>
  <url><loc>https://omefly.online/safety</loc><priority>0.8</priority></url>
  <url><loc>https://omefly.online/faq</loc><priority>0.8</priority></url>
</urlset>`);
});
// ─────────────────────────────────────────────────────────────────────────────

// ── Favicon.ico — serve real OmeFly logo PNG ────────────────────────────────
app.get('/favicon.ico', (req, res) => {
  const faviconPng = Buffer.from(
    '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', 'base64'
  );
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(faviconPng);
});

const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  transports: ['websocket', 'polling']
});

// ── Force HTTPS + fix http:// problem ────────────────────────────────────────
// Render/Railway send x-forwarded-proto header to detect original protocol
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] === 'http') {
    // 301 permanent redirect to https — fixes Google "Page with redirect" warning
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});
// ─────────────────────────────────────────────────────────────────────────────

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

// Track active device sessions: deviceId -> socketId
// Prevents same browser/device opening multiple tabs
const deviceSessions = new Map();

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

// Country lookup via ip-api.com HTTP (works from servers, 45 req/min free, no key needed)
function lookupCountry(ip, cb) {
  // Skip lookup for local/private IPs
  if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::ffff:127.0.0.1') {
    return cb({ country: 'Local', countryCode: 'UN' });
  }
  const cleanIP = ip.replace('::ffff:', '');
  // ip-api.com HTTP (not HTTPS) works freely from server IPs with no key
  const options = {
    hostname: 'ip-api.com',
    path: `/json/${cleanIP}?fields=status,country,countryCode`,
    method: 'GET',
    headers: { 'User-Agent': 'OmeFly/1.0' }
  };
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.status === 'success') {
          cb({ country: json.country || 'Unknown', countryCode: json.countryCode || 'UN' });
        } else {
          console.log('ip-api fail for', cleanIP, json);
          cb({ country: 'Unknown', countryCode: 'UN' });
        }
      } catch(e) { cb({ country: 'Unknown', countryCode: 'UN' }); }
    });
  });
  req.on('error', (e) => { console.log('Country lookup error:', e.message); cb({ country: 'Unknown', countryCode: 'UN' }); });
  req.setTimeout(4000, () => { req.destroy(); cb({ country: 'Unknown', countryCode: 'UN' }); });
  req.end();
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
  const decoyIndex = Math.floor(Math.random() * 5); // shared decoy for all room members
  room.members.forEach(m => m.emit('group-searching', { decoyIndex }));
  f0.groupSession = `room-${roomCode}`;
  f0.groupRole = 'friend';
  f0.groupPartners = [f1];
  f1.groupSession = `room-${roomCode}`;
  f1.groupRole = 'friend';
  f1.groupPartners = [f0];
  f0.emit('friend-preview-ready', { peer: { id: f1.id, slot: 0, isOfferer: f0.id < f1.id }, decoyIndex });
  f1.emit('friend-preview-ready', { peer: { id: f0.id, slot: 0, isOfferer: f1.id < f0.id }, decoyIndex });

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
          { id: f1.id, slot: 0, isOfferer: f0.id < f1.id, country: f1.country || 'Unknown', countryCode: f1.countryCode || 'UN' },
          { id: st.id, slot: 1, isOfferer: f0.id < st.id, country: st.country || 'Unknown', countryCode: st.countryCode || 'UN' }
        ]
      }
    },
    {
      socket: f1,
      data: {
        sessionId, role: 'friend', commonInterests,
        peers: [
          { id: f0.id, slot: 0, isOfferer: f1.id < f0.id, country: f0.country || 'Unknown', countryCode: f0.countryCode || 'UN' },
          { id: st.id, slot: 1, isOfferer: f1.id < st.id, country: st.country || 'Unknown', countryCode: st.countryCode || 'UN' }
        ]
      }
    },
    {
      socket: st,
      data: {
        sessionId, role: 'stranger', commonInterests,
        peers: [
          { id: f0.id, slot: 0, isOfferer: st.id < f0.id, country: f0.country || 'Unknown', countryCode: f0.countryCode || 'UN' },
          { id: f1.id, slot: 1, isOfferer: st.id < f1.id, country: f1.country || 'Unknown', countryCode: f1.countryCode || 'UN' }
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
  io.emit('user-count', { count: onlineCount + 5 }); // +5 decoy strangers always online
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
  a.emit('matched', { partnerId: b.id, sessionId, commonInterests, isOfferer: a.id < b.id, partnerCountry: b.country || 'Unknown', partnerCountryCode: b.countryCode || 'UN' });
  b.emit('matched', { partnerId: a.id, sessionId, commonInterests, isOfferer: b.id < a.id, partnerCountry: a.country || 'Unknown', partnerCountryCode: a.countryCode || 'UN' });
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
  const deviceId = socket.handshake.auth && socket.handshake.auth.deviceId;

  // One session per device — kick duplicate tabs/browsers
  if (deviceId) {
    const existingSocketId = deviceSessions.get(deviceId);
    if (existingSocketId && existingSocketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        // Old session is still alive — reject the new one
        socket.emit('duplicate-session');
        socket.disconnect(true);
        return;
      }
    }
    deviceSessions.set(deviceId, socket.id);
    socket.deviceId = deviceId;
  }

  // Look up country on connect — set a flag so matching waits for it
  socket.country = 'Unknown';
  socket.countryCode = 'UN';
  socket.countryReady = false;
  lookupCountry(clientIP, ({ country, countryCode }) => {
    socket.country = country;
    socket.countryCode = countryCode;
    socket.countryReady = true;
    // If already matched with a partner, push updated country to their client
    if (socket.partner) {
      socket.partner.emit('partner-country-update', { country, countryCode });
    }
  });

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

  socket.on('media-state', (data) => {
    if (socket.partner) socket.partner.emit('partner-media-state', data);
  });

  // ---- disconnect ----
  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastUserCount();
    // Free up device slot so user can reconnect
    if (socket.deviceId && deviceSessions.get(socket.deviceId) === socket.id) {
      deviceSessions.delete(socket.deviceId);
    }
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

// ── SPA catch-all — serve index.html for all unknown routes ──────────────────
// Fixes 404 on /safety /faq /omegle-alternative (SPA routes handled by JS)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3003;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
