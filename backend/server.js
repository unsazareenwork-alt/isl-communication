const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");

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

// Basic API test
app.get("/", (req, res) => {
    res.json({
        message: "ISL Communication Backend is running!"
    });
});


// Socket connection
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Join a meeting room
    socket.on("join-meeting", ({ meetingCode, userName }) => {
        socket.join(meetingCode);
        socket.data.meetingCode = meetingCode;
        socket.data.userName = userName;

        console.log(`${userName || socket.id} joined meeting ${meetingCode}`);

        // Notify others in the room that someone joined
        socket.to(meetingCode).emit("user-joined", {
            socketId: socket.id,
            userName: userName || "Anonymous"
        });
    });

    // Chat / subtitle message broadcast
    socket.on("send-message", (data) => {
        const { meetingCode } = socket.data;
        if (!meetingCode) return;

        // Broadcast to everyone else in the room (not back to sender)
        socket.to(meetingCode).emit("receive-message", data);
    });

    socket.on("disconnect", () => {
        const { meetingCode, userName } = socket.data;
        console.log("User disconnected:", socket.id);

        if (meetingCode) {
            socket.to(meetingCode).emit("user-left", {
                socketId: socket.id,
                userName: userName || "Anonymous"
            });
        }
    });
});

// Server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});