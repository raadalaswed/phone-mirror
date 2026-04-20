const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;

// ─── HTTP Server ───────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const file = path.join(__dirname, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ─── Socket.IO (Signaling) ─────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// rooms: { roomId: { phone: socketId | null, pc: socketId | null } }
const rooms = {};

io.on("connection", (socket) => {
  console.log(`🔌 اتصال جديد: ${socket.id}`);

  // ── الهاتف: إنشاء غرفة ──────────────────────────────────
  socket.on("create-room", (roomId) => {
    if (!rooms[roomId]) rooms[roomId] = { phone: null, pc: null };
    rooms[roomId].phone = socket.id;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = "phone";
    console.log(`📱 هاتف أنشأ الغرفة: ${roomId}`);
    socket.emit("room-created", roomId);
  });

  // ── الكمبيوتر: الانضمام لغرفة ───────────────────────────
  socket.on("join-room", (roomId) => {
    if (!rooms[roomId] || !rooms[roomId].phone) {
      socket.emit("error", "الغرفة غير موجودة أو الهاتف غير متصل");
      return;
    }
    rooms[roomId].pc = socket.id;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.role = "pc";
    console.log(`🖥️  كمبيوتر انضم للغرفة: ${roomId}`);
    // أخبر الهاتف أن الكمبيوتر جاهز
    io.to(rooms[roomId].phone).emit("pc-joined");
    socket.emit("room-joined", roomId);
  });

  // ── WebRTC Signaling: تمرير الرسائل بين الطرفين ──────────
  socket.on("offer", (data) => {
    const room = rooms[data.roomId];
    if (room && room.pc) io.to(room.pc).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    const room = rooms[data.roomId];
    if (room && room.phone) io.to(room.phone).emit("answer", data.answer);
  });

  socket.on("ice-candidate", (data) => {
    const room = rooms[data.roomId];
    if (!room) return;
    const target = data.to === "pc" ? room.pc : room.phone;
    if (target) io.to(target).emit("ice-candidate", data.candidate);
  });

  // ── قطع الاتصال ──────────────────────────────────────────
  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    if (socket.role === "phone") {
      console.log(`📱 الهاتف غادر الغرفة: ${roomId}`);
      if (rooms[roomId].pc) io.to(rooms[roomId].pc).emit("phone-left");
      delete rooms[roomId];
    } else if (socket.role === "pc") {
      console.log(`🖥️  الكمبيوتر غادر الغرفة: ${roomId}`);
      rooms[roomId].pc = null;
      if (rooms[roomId].phone) io.to(rooms[roomId].phone).emit("pc-left");
    }
  });
});

// ─── Start ────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n✅ Phone Mirror Server يعمل!`);
  console.log(`🌐 افتح المتصفح على: http://localhost:${PORT}`);
  console.log(`─────────────────────────────────────────\n`);
});
