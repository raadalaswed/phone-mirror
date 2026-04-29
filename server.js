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
  } else if (req.url === "/chat" || req.url === "/chat.html") {
    const file = path.join(__dirname, "chat.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ─── Socket.IO ────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// ══════════════════════════════════════════════════════════
//   VIDEO ROOMS — لم يُعدَّل أي شيء هنا
// ══════════════════════════════════════════════════════════

// rooms: { roomId: { phone: socketId | null, pc: socketId | null } }
const videoRooms = {};

// ══════════════════════════════════════════════════════════
//   CHAT ROOMS
//   chatRooms: {
//     roomId: {
//       users: { socketId: { name, joinedAt } },
//       messages: [ { id, user, text, time } ]   ← آخر 100 فقط
//     }
//   }
// ══════════════════════════════════════════════════════════
const chatRooms = {};

// ── Helpers ───────────────────────────────────────────────
function getUniqueUsername(roomId, requestedName) {
  const room = chatRooms[roomId];
  if (!room) return requestedName;
  const takenNames = Object.values(room.users).map(u => u.name.toLowerCase());
  if (!takenNames.includes(requestedName.toLowerCase())) return requestedName;
  let counter = 2;
  while (takenNames.includes(`${requestedName}${counter}`.toLowerCase())) counter++;
  return `${requestedName}${counter}`;
}

function getRoomUserList(roomId) {
  const room = chatRooms[roomId];
  if (!room) return [];
  return Object.values(room.users).map(u => u.name);
}

// ─── All Socket Events ────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`🔌 اتصال جديد: ${socket.id}`);

  // ════════════════════════════════════════════
  //  VIDEO SIGNALING (بدون أي تعديل)
  // ════════════════════════════════════════════

  socket.on("create-room", (roomId) => {
    if (!videoRooms[roomId]) videoRooms[roomId] = { phone: null, pc: null };
    videoRooms[roomId].phone = socket.id;
    socket.join("video:" + roomId);
    socket.videoRoomId = roomId;
    socket.role = "phone";
    console.log(`📱 هاتف أنشأ الغرفة: ${roomId}`);
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {
    if (!videoRooms[roomId] || !videoRooms[roomId].phone) {
      socket.emit("error", "الغرفة غير موجودة أو الهاتف غير متصل");
      return;
    }
    videoRooms[roomId].pc = socket.id;
    socket.join("video:" + roomId);
    socket.videoRoomId = roomId;
    socket.role = "pc";
    console.log(`🖥️  كمبيوتر انضم للغرفة: ${roomId}`);
    io.to(videoRooms[roomId].phone).emit("pc-joined");
    socket.emit("room-joined", roomId);
  });

  socket.on("offer", (data) => {
    const room = videoRooms[data.roomId];
    if (room && room.pc) io.to(room.pc).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    const room = videoRooms[data.roomId];
    if (room && room.phone) io.to(room.phone).emit("answer", data.answer);
  });

  socket.on("ice-candidate", (data) => {
    const room = videoRooms[data.roomId];
    if (!room) return;
    const target = data.to === "pc" ? room.pc : room.phone;
    if (target) io.to(target).emit("ice-candidate", data.candidate);
  });

  // ════════════════════════════════════════════
  //  CHAT EVENTS
  // ════════════════════════════════════════════

  // المستخدم يطلب الانضمام لغرفة شات
  socket.on("chat:join", ({ roomId, name }) => {
    if (!roomId || !name) return;

    const cleanRoom = roomId.trim().toUpperCase();
    const cleanName = name.trim().slice(0, 20) || "مجهول";

    // أنشئ الغرفة إذا لم تكن موجودة
    if (!chatRooms[cleanRoom]) {
      chatRooms[cleanRoom] = { users: {}, messages: [] };
    }

    // تأكد من فرادة الاسم
    const uniqueName = getUniqueUsername(cleanRoom, cleanName);

    // سجّل المستخدم
    chatRooms[cleanRoom].users[socket.id] = {
      name: uniqueName,
      joinedAt: Date.now()
    };

    socket.join("chat:" + cleanRoom);
    socket.chatRoomId = cleanRoom;
    socket.chatName = uniqueName;

    console.log(`💬 ${uniqueName} انضم للشات: ${cleanRoom}`);

    // أرسل للمستخدم تأكيد + آخر 50 رسالة
    socket.emit("chat:joined", {
      name: uniqueName,
      roomId: cleanRoom,
      history: chatRooms[cleanRoom].messages.slice(-50),
      users: getRoomUserList(cleanRoom)
    });

    // أعلم الجميع في الغرفة
    socket.to("chat:" + cleanRoom).emit("chat:user-joined", {
      name: uniqueName,
      users: getRoomUserList(cleanRoom)
    });
  });

  // إرسال رسالة
  socket.on("chat:message", (text) => {
    const roomId = socket.chatRoomId;
    if (!roomId || !chatRooms[roomId]) return;
    if (!text || typeof text !== "string") return;

    const cleanText = text.trim().slice(0, 1000);
    if (!cleanText) return;

    const msg = {
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      user: socket.chatName,
      text: cleanText,
      time: new Date().toISOString()
    };

    // احفظ الرسالة (آخر 100)
    chatRooms[roomId].messages.push(msg);
    if (chatRooms[roomId].messages.length > 100) {
      chatRooms[roomId].messages.shift();
    }

    // أرسلها لكل من في الغرفة بما فيهم المرسل
    io.to("chat:" + roomId).emit("chat:message", msg);
    console.log(`💬 [${roomId}] ${socket.chatName}: ${cleanText.slice(0, 40)}`);
  });

  // مؤشر الكتابة
  socket.on("chat:typing", (isTyping) => {
    const roomId = socket.chatRoomId;
    if (!roomId) return;
    socket.to("chat:" + roomId).emit("chat:typing", {
      name: socket.chatName,
      isTyping: !!isTyping
    });
  });

  // ── قطع الاتصال ──────────────────────────────────────────
  socket.on("disconnect", () => {
    // Video cleanup
    const videoRoomId = socket.videoRoomId;
    if (videoRoomId && videoRooms[videoRoomId]) {
      if (socket.role === "phone") {
        console.log(`📱 الهاتف غادر الغرفة: ${videoRoomId}`);
        if (videoRooms[videoRoomId].pc) io.to(videoRooms[videoRoomId].pc).emit("phone-left");
        delete videoRooms[videoRoomId];
      } else if (socket.role === "pc") {
        console.log(`🖥️  الكمبيوتر غادر الغرفة: ${videoRoomId}`);
        videoRooms[videoRoomId].pc = null;
        if (videoRooms[videoRoomId].phone) io.to(videoRooms[videoRoomId].phone).emit("pc-left");
      }
    }

    // Chat cleanup
    const chatRoomId = socket.chatRoomId;
    if (chatRoomId && chatRooms[chatRoomId]) {
      const name = socket.chatName;
      delete chatRooms[chatRoomId].users[socket.id];
      console.log(`💬 ${name} غادر الشات: ${chatRoomId}`);

      const remaining = getRoomUserList(chatRoomId);

      if (remaining.length === 0) {
        // الغرفة فارغة — احذفها
        delete chatRooms[chatRoomId];
        console.log(`🗑️  غرفة الشات محذوفة: ${chatRoomId}`);
      } else {
        io.to("chat:" + chatRoomId).emit("chat:user-left", {
          name,
          users: remaining
        });
      }
    }
  });
});

// ─── Start ────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n✅ Server يعمل!`);
  console.log(`🎥 Phone Mirror: http://localhost:${PORT}`);
  console.log(`💬 Chat: http://localhost:${PORT}/chat`);
  console.log(`─────────────────────────────────────────\n`);
});
