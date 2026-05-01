# TODO - Fix WebRTC Issues

## Task: Fix WebRTC video/audio connection issues

### Issues:
1. "Ignoring answer - wrong state: stable" - Race condition
2. ICE connection state checking/connecting - May hang
3. Remote video not showing
4. favicon.ico 404

### Plan:
- [x] 1. Fix WebRTC race condition in index.html (answer handler)
- [x] 2. Add proper state tracking for remote offer
- [x] 3. Fix ontrack handler for multiple tracks
- [x] 4. Add ICE connection timeout handling
- [x] 5. Create favicon (inline SVG)

### Fix Implementation:
1. Client-side: Add `hasRemoteOffer` flag to track remote offer state
2. Store answer if received before remote description is set (pendingAnswer)
3. Fix ontrack to properly handle multiple tracks
4. Add connection timeout after 30 seconds
5. Add inline SVG favicon (no separate file needed)

### Status: Completed
