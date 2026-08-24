# ISL Communication Backend — API Reference

Base URL (local dev): `http://localhost:5000`

All protected routes require this header:
```
Authorization: Bearer <access_token>
```
The `access_token` comes from the login or signup response (`session.access_token`).

---

## Auth

### Sign up
`POST /api/auth/signup`

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SomePassword1!",
  "name": "User Name",
  "is_deaf_mute": false,
  "preferred_language": "en"
}
```
`email`, `password`, and `name` are required. `is_deaf_mute` and `preferred_language` are optional.

**Success (201):**
```json
{
  "message": "Signup successful",
  "user": { "id": "...", "email": "...", ... },
  "session": { "access_token": "...", ... }
}
```

**Errors:** `400` — missing fields, invalid email, or user already registered.

---

### Log in
`POST /api/auth/login`

**Body:**
```json
{
  "email": "user@example.com",
  "password": "SomePassword1!"
}
```

**Success (200):**
```json
{
  "message": "Login successful",
  "user": { "id": "...", "email": "...", "user_metadata": { "name": "...", ... } },
  "session": { "access_token": "...", ... }
}
```

**Errors:** `401` — invalid email or password.

**Note:** `access_token` expires after about an hour. There is no refresh-token endpoint yet — the frontend will need to handle re-login when a token expires (a `401 "Invalid or expired token"` response from any protected route signals this).

---

## Meetings

All meetings routes require the `Authorization` header.

### Create a meeting
`POST /api/meetings/create`

No body required. The logged-in user becomes the host and is automatically added as a participant.

**Success (201):**
```json
{
  "message": "Meeting created",
  "meeting": {
    "id": "uuid",
    "host_id": "uuid",
    "meeting_code": "abc1-de2f-gh3i",
    "status": "active",
    "started_at": "...",
    "ended_at": null
  }
}
```

---

### Join a meeting
`POST /api/meetings/join/:code`

`:code` is the short `meeting_code` (e.g. `abc1-de2f-gh3i`).

**Success (200):**
```json
{
  "message": "Joined meeting",
  "meeting": { ... },
  "participant": { "id": "...", "meeting_id": "...", "user_id": "...", "joined_at": "...", "left_at": null }
}
```

**Errors:** `404` — meeting not found or not active.

---

### Leave a meeting
`POST /api/meetings/leave/:id`

`:id` is the meeting's **UUID** (`meeting.id`, not the short code).

Records `left_at` for the current user in that meeting. This also happens automatically if the user simply disconnects (closes tab/loses connection) — this endpoint is for an explicit "Leave" button.

**Success (200):**
```json
{
  "message": "Left meeting",
  "participant": { ... "left_at": "..." }
}
```

**Errors:** `404` — no active participation found (already left, or never joined).

---

### End a meeting
`POST /api/meetings/end/:id`

`:id` is the meeting's UUID. Only the host can end a meeting.

**Success (200):**
```json
{
  "message": "Meeting ended",
  "meeting": { ... "status": "ended", "ended_at": "..." }
}
```

**Errors:** `403` — not the host. `404` — meeting not found.

---

## Messages

All message routes require the `Authorization` header. Used for chat messages and (later) AI-translated sign/speech text.

### Save a message
`POST /api/messages`

**Body:**
```json
{
  "meeting_id": "uuid",
  "message_type": "chat",
  "original_text": "Hello!",
  "translated_text": null,
  "language": "en"
}
```
- `meeting_id`, `message_type`, `original_text` are required.
- `message_type` must be one of: `chat`, `sign_translation`, `speech_translation`.
- `translated_text` and `language` are optional (`language` defaults to `"en"`).

**Success (201):**
```json
{
  "message": "Message saved",
  "data": { "id": "...", "meeting_id": "...", "sender_id": "...", "message_type": "...", ... }
}
```

---

### Fetch messages for a meeting
`GET /api/messages/:meetingId`

`:meetingId` is the meeting's UUID.

**Success (200):**
```json
{
  "messages": [
    { "id": "...", "message_type": "chat", "original_text": "...", "created_at": "..." },
    ...
  ]
}
```
Returned in chronological order (oldest first) — this is the full transcript.

---

## Real-time (Socket.IO)

Connect to: `http://localhost:5000` (same server, default namespace).

### Client → Server events

**`join-meeting`**
```json
{
  "meetingCode": "abc1-de2f-gh3i",
  "userName": "User Name",
  "userId": "uuid",
  "meetingId": "uuid"
}
```
Puts the socket into a room for that meeting. `userId` and `meetingId` are needed so the server can record leave times in the database — always send all four fields.

**`send-message`**
```json
{ "text": "Hello", "userName": "User Name" }
```
Broadcasts to everyone else in the same meeting room (not saved to the database — use `POST /api/messages` for persistence, and emit this separately for live delivery).

**`webrtc-offer`** / **`webrtc-answer`** / **`webrtc-ice-candidate`**
Used internally for video call signaling. See `webrtc-test.html` in the backend repo for a full working example of the call flow — frontend video call implementation should follow that same event sequence.

### Server → Client events

- **`user-joined`** — `{ socketId, userName }` — someone joined your meeting room
- **`user-left`** — `{ socketId, userName }` — someone left or disconnected
- **`receive-message`** — `{ text, userName }` — a chat message from someone else in the room

---

## Language display (for subtitle UI)

Every saved message (chat, sign_translation, speech_translation) contains both:
- `original_text` — English (the AI's recognized sign, or the original spoken/typed text)
- `translated_text` — Tamil translation, auto-generated by the backend

**A language dropdown (English / Tamil) is a pure frontend display decision** — both values already arrive together in the same message object, live via Socket.IO (`sign-translation` event for AI predictions, `new-message` event for chat/speech). Just show whichever field matches the user's selected language; no extra API call needed to switch languages.

More languages (Hindi, Telugu, etc.) are planned for later — this will require a backend schema change (a `translations` object instead of a single `translated_text` field), so don't build the dropdown UI assuming more than these two yet.

## Known limitations (as of now)

- No token refresh endpoint — frontend must re-login on `401` expiry.
- Two-person calls only — no group call support yet.
- No rate limiting or advanced input validation yet on the REST API.
- `/api/ai/predict` (for AI sign-recognition integration) does not exist yet — planned once the AI module has live predictions.