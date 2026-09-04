const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");
const supabase = require('./supabaseClient');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);
const authMiddleware = require('./middleware/authMiddleware');
const meetingRoutes = require('./routes/meetings');
app.use('/api/meetings', meetingRoutes);
const messageRoutes = require('./routes/messages');
app.use('/api/messages', messageRoutes);
const aiRoutes = require('./routes/ai');
app.use('/api/ai', aiRoutes);
app.use(express.static(__dirname));

app.get('/api/protected-test', authMiddleware, (req, res) => {
  res.json({ message: 'You are authenticated!', user: req.user });
});

// Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.set('io', io);

// Tracks the single active socket per (meetingCode, userId), so the same
// user opening the same meeting in a second tab/browser replaces their old
// connection instead of showing up as a second participant.
// Key: `${meetingCode}::${userId}`  Value: socket.id of the current active socket
const activeUserSockets = new Map();
const activeKey = (meetingCode, userId) => `${meetingCode}::${userId}`;

app.get("/", (req, res) => {
    res.json({
        message: "ISL Communication Backend is running!"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
});

// Socket connection
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join a meeting room
    socket.on("join-meeting", ({ meetingCode, userName, userId, meetingId }) => {
        // If this same (meetingCode, userId) already has an active socket
        // (e.g. same user opened a second tab/browser), replace it cleanly
        // instead of letting both sockets sit in the room as two participants.
        if (userId) {
            const key = activeKey(meetingCode, userId);
            const oldSocketId = activeUserSockets.get(key);
            if (oldSocketId && oldSocketId !== socket.id) {
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    // Mark it so its own "disconnect" handler knows it was
                    // replaced, not a real leave — skips emitting user-left /
                    // writing left_at for a user who is actually still here.
                    oldSocket.data.replacedBy = socket.id;
                    oldSocket.leave(meetingCode);
                    if (oldSocket.data.meetingId) oldSocket.leave(oldSocket.data.meetingId);
                    oldSocket.disconnect(true);
                }
            }
            activeUserSockets.set(key, socket.id);
        }

        const room = io.sockets.adapter.rooms.get(meetingCode);
        const existingParticipants = [];
        if (room) {
            for (const socketId of room) {
                if (socketId === socket.id) continue;
                const existingSocket = io.sockets.sockets.get(socketId);
                if (existingSocket) {
                    existingParticipants.push({
                        socketId: existingSocket.id,
                        userId: existingSocket.data.userId || null,
                        userName: existingSocket.data.userName || "Anonymous",
                        cameraOn: existingSocket.data.cameraOn !== undefined ? existingSocket.data.cameraOn : true,
                        micOn: existingSocket.data.micOn !== undefined ? existingSocket.data.micOn : true
                    });
                }
            }
        }

        socket.join(meetingCode);
        if (meetingId) socket.join(meetingId);
        socket.data.meetingCode = meetingCode;
        socket.data.userName = userName;
        socket.data.userId = userId;
        socket.data.meetingId = meetingId;
        // Track current media state so late joiners could query it later if needed
        socket.data.cameraOn = true;
        socket.data.micOn = true;

        console.log(`${userName || socket.id} joined meeting ${meetingCode}`);

        socket.emit("existing-participants", existingParticipants);

        socket.to(meetingCode).emit("user-joined", {
            socketId: socket.id,
            userId: userId || null,
            userName: userName || "Anonymous"
        });
    });

    // WebRTC signaling
    socket.on("webrtc-offer", ({ offer, to }) => {
        if (!to) return;
        io.to(to).emit("webrtc-offer", { offer, from: socket.id });
    });

    socket.on("webrtc-answer", ({ answer, to }) => {
        if (!to) return;
        io.to(to).emit("webrtc-answer", { answer, from: socket.id });
    });

    socket.on("webrtc-ice-candidate", ({ candidate, to }) => {
        if (!to) return;
        io.to(to).emit("webrtc-ice-candidate", { candidate, from: socket.id });
    });

    // Camera/mic toggle signaling — lets other participants know when
    // someone turns their camera or mic on/off, so their UI can update
    // (e.g. show a "camera off" placeholder instead of a frozen video tile).
    socket.on("toggle-media", ({ cameraOn, micOn }) => {
        const { meetingCode, userName } = socket.data;
        if (!meetingCode) return;

        if (cameraOn !== undefined) socket.data.cameraOn = cameraOn;
        if (micOn !== undefined) socket.data.micOn = micOn;

        socket.to(meetingCode).emit("peer-media-toggle", {
            socketId: socket.id,
            userName: userName || "Anonymous",
            cameraOn: socket.data.cameraOn,
            micOn: socket.data.micOn
        });
    });

    // Chat / subtitle message broadcast
    socket.on("send-message", (data) => {
        const { meetingCode } = socket.data;
        if (!meetingCode) return;
        socket.to(meetingCode).emit("receive-message", data);
    });

    socket.on("disconnect", async () => {
        const { meetingCode, userName, userId, meetingId, replacedBy } = socket.data;
        console.log("User disconnected:", socket.id);

        // This socket was replaced by a newer connection from the same user
        // (rejoin from another tab/browser) — the user is still present via
        // the new socket, so don't emit user-left or mark them as having
        // left in the DB. Just clean up silently.
        if (replacedBy) {
            return;
        }

        if (meetingCode) {
            socket.to(meetingCode).emit("user-left", {
                socketId: socket.id,
                userId: userId || null,
                userName: userName || "Anonymous"
            });
        }

        // Only remove this socket's map entry if it's still the recorded
        // active socket for this user — avoids a stale/late disconnect event
        // wiping out a newer connection's entry.
        if (userId && meetingCode) {
            const key = activeKey(meetingCode, userId);
            if (activeUserSockets.get(key) === socket.id) {
                activeUserSockets.delete(key);
            }
        }

        if (userId && meetingId) {
            try {
                await supabase
                    .from('meeting_participants')
                    .update({ left_at: new Date().toISOString() })
                    .eq('meeting_id', meetingId)
                    .eq('user_id', userId)
                    .is('left_at', null);
            } catch (err) {
                console.error('Failed to record participant leave time:', err.message);
            }
        }
    });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Also accessible on your network at http://192.168.1.85:${PORT}`);
});