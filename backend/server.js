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
        const room = io.sockets.adapter.rooms.get(meetingCode);
        const existingParticipants = [];
        if (room) {
            for (const socketId of room) {
                const existingSocket = io.sockets.sockets.get(socketId);
                if (existingSocket) {
                    existingParticipants.push({
                        socketId: existingSocket.id,
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
        const { meetingCode, userName, userId, meetingId } = socket.data;
        console.log("User disconnected:", socket.id);

        if (meetingCode) {
            socket.to(meetingCode).emit("user-left", {
                socketId: socket.id,
                userName: userName || "Anonymous"
            });
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