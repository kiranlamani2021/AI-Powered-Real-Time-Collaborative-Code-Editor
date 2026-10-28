const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const mongoose = require("mongoose");

const {
  authenticateRequest,
  authenticateSocket,
} = require("./middleware/authMiddleware");

const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : ["http://localhost:5173"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

/* ---------------- HEALTH CHECK ---------------- */

// Lightweight probe for hosting health checks (no auth, no secrets).
// `runtimes` reports which compilers/interpreters this host can actually
// spawn, so a production deployment can verify language support directly.
let runtimeProbeCache = null;

const probeRuntime = (command, args) =>
  new Promise((resolve) => {
    const probe = spawn(command, args, {
      windowsHide: true,
      stdio: "ignore",
    });
    const done = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    let settled = false;
    const timer = setTimeout(() => {
      try {
        probe.kill();
      } catch { /* already gone */ }
      done(false);
    }, 3000);
    probe.on("error", () => done(false));
    probe.on("close", (code) => done(code === 0));
  });

const probeRuntimes = async () => {
  if (runtimeProbeCache) return runtimeProbeCache;

  const { SUPPORTED_LANGUAGES } = require("./services/executor");

  const checks = [
    ["javascript", process.execPath, ["--version"]],
    ["python", process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"), ["--version"]],
    ["cpp", "g++", ["--version"]],
    ["java", "javac", ["-version"]],
    ["go", process.env.GO_BIN || (process.platform === "win32" ? "C:\\Program Files\\Go\\bin\\go.exe" : "go"), ["version"]],
    ["php", process.env.PHP_BIN || (process.platform === "win32" ? "C:\\Cphp\\php.exe" : "php"), ["--version"]],
  ];

  const results = {};
  await Promise.all(
    checks.map(async ([language, command, args]) => {
      results[language] =
        SUPPORTED_LANGUAGES.includes(language) && (await probeRuntime(command, args));
    })
  );

  runtimeProbeCache = results;
  return results;
};

app.get("/health", async (req, res) => {
  const readyStates = ["disconnected", "connected", "connecting", "disconnecting"];
  const mongodb = readyStates[mongoose.connection.readyState] || "unknown";
  const runtimes = await probeRuntimes();

  res.status(mongodb === "connected" ? 200 : 503).json({
    status: mongodb === "connected" ? "ok" : "degraded",
    uptimeSeconds: Math.round(process.uptime()),
    mongodb,
    codeExecution: executionEnabled ? "enabled" : "disabled",
    runtimes,
  });
});

app.use("/project", authenticateRequest, require("./routes/projectRoutes"));
app.use("/api/auth", authRoutes);

/* ---------------- MONGODB ---------------- */

if (!process.env.MONGO_URI) {
  // Fail fast with an actionable message instead of a cryptic mongoose error.
  console.error(
    "[Startup] MONGO_URI is not set. Add it to the environment (host dashboard or .env) and restart."
  );
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected");
  })
  .catch((error) => {
    // Keep the process alive: the driver keeps retrying in the background
    // (transient Atlas network drops recover on their own). /health reports
    // 503 while the database is unreachable.
    console.error(
      `[MongoDB] Initial connect failed: ${error.message}. The driver will keep retrying.`,
    );
  });

mongoose.connection.on("disconnected", () => {
  console.warn("[MongoDB] Disconnected — reconnecting automatically.");
});
mongoose.connection.on("reconnected", () => {
  console.log("[MongoDB] Reconnected.");
});

/* ---------------- CODEPILOT AI SERVICE ---------------- */

const { askCodePilot } = require("./services/aiService");

/* ---------------- SERVER ---------------- */

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : ["http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.use(authenticateSocket);

/* ---------------- SOCKETS ---------------- */

const roomUsers = {};
const videoRooms = {};

const emitRoomUsers = (roomId) => {
  io.to(roomId).emit("users-update", roomUsers[roomId] || []);
};

const isRoomMember = (socket, roomId) =>
  Boolean(roomId && socket.roomId === roomId);

const validateRoomId = (roomId) =>
  typeof roomId === "string" && /^[a-zA-Z0-9_-]{3,64}$/.test(roomId);

io.on("connection", (socket) => {
  // ================= GROUP VIDEO CALL =================

  socket.on("join-video-call", ({ roomId, username }) => {
    if (!isRoomMember(socket, roomId)) return;

    if (!videoRooms[roomId]) {
      videoRooms[roomId] = [];
    }

    const existingUsers = videoRooms[roomId];

    // Send existing users to the new user
    socket.emit("video-existing-users", existingUsers);

    // Add new user
    videoRooms[roomId].push({
      socketId: socket.id,
      username: username
    });

    socket.videoRoomId = roomId;
    socket.videoUsername = username;

    // Tell other users that a new user joined
    socket.to(roomId).emit("video-user-joined", {
      socketId: socket.id,
      username: username
    });
  });


  // WebRTC signaling
  socket.on("video-signal", ({ to, signal }) => {
    io.to(to).emit("video-signal", {
      from: socket.id,
      signal: signal,
      username: socket.videoUsername
    });
  });


  // Camera / microphone state
  socket.on(
    "video-state-change",
    ({ roomId, cameraOn, micOn }) => {
      if (!isRoomMember(socket, roomId)) return;
      socket.to(roomId).emit("video-state-change", {
        socketId: socket.id,
        cameraOn: cameraOn,
        micOn: micOn
      });
    }
  );


  // Leave video call
  socket.on("leave-video-call", () => {
    const roomId = socket.videoRoomId;

    if (!roomId || !videoRooms[roomId]) {
      return;
    }

    videoRooms[roomId] = videoRooms[roomId].filter(
      (user) => user.socketId !== socket.id
    );

    socket.to(roomId).emit("video-user-left", {
      socketId: socket.id
    });

    socket.videoRoomId = null;
    socket.videoUsername = null;
  });
  socket.on(
    "send-message",
    ({ roomId, message }) => {

      if (!isRoomMember(socket, roomId) || typeof message !== "string") {
        return;
      }

      io.to(roomId).emit(
        "receive-message",
        {
          message: message.slice(0, 2000),
          username: socket.username,
        }
      );
    }
  );
  socket.on(
    "cursor-change",
    ({ roomId, cursorPosition, username }) => {
      if (!isRoomMember(socket, roomId) || !cursorPosition) return;
      socket.to(roomId).emit(
        "cursor-update",
        {
          cursorPosition,
          username: socket.username,
        }
      );
    }
  );
  socket.on(
    "input-change",
    ({ roomId, input }) => {

      if (!isRoomMember(socket, roomId)) return;

      socket.to(roomId).emit(
        "input-updated",
        { input }
      );
    }
  );
  socket.on(
    "language-change",
    ({ roomId, fileName, language }) => {

      if (!isRoomMember(socket, roomId)) return;

      socket.to(roomId).emit(
        "language-changed",
        { fileName, language }
      );
    }
  );
  console.log("User connected");

  socket.on(
    "join-room",
    ({ roomId, username }) => {

      if (typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
        return;
      }

      const authenticatedUsername = socket.user.username || username || "Guest";

      if (socket.roomId && socket.roomId !== roomId) {
        const previousRoom = socket.roomId;
        roomUsers[previousRoom] = (roomUsers[previousRoom] || []).filter(
          (user) => user.socketId !== socket.id
        );
        emitRoomUsers(previousRoom);
        socket.leave(previousRoom);
      }

      socket.join(roomId);

      socket.roomId = roomId;

      socket.username = authenticatedUsername;

      if (!roomUsers[roomId]) {
        roomUsers[roomId] = [];
      }

      // Replace an older connection for the same authenticated user.
      roomUsers[roomId] =
        roomUsers[roomId].filter(
          (user) =>
            user.userId !== socket.user.id
        );

      // ADD fresh user
      roomUsers[roomId].push({
        userId: socket.user.id,
        username: authenticatedUsername,
        socketId: socket.id,
        status: "online",
      });

      emitRoomUsers(roomId);
    }
  );

  // CODE SYNC
  socket.on(
    "code-change",
    ({ roomId, fileName, code }) => {
      if (!isRoomMember(socket, roomId) || typeof fileName !== "string" || typeof code !== "string" || code.length > 100000) return;
      socket.to(roomId).emit("receive-code", {
        fileName,
        code,
      });
    }
  );
  socket.on(
    "switch-file",
    ({ roomId, fileName }) => {
      if (!isRoomMember(socket, roomId) || typeof fileName !== "string" || !/^[\w.\-]+$/.test(fileName)) return;

      socket.to(roomId).emit(
        "file-switched",
        { fileName }
      );
    }
  );

  // NEW FILE SYNC
  socket.on("new-file", ({ roomId, fileName }) => {
    if (!isRoomMember(socket, roomId) || typeof fileName !== "string" || !/^[\w.\-]+$/.test(fileName)) return;
    socket.to(roomId).emit("file-created", {
      fileName,
    });
  });
  socket.on(
    "rename-file",
    ({
      roomId,
      oldFileName,
      newFileName,
    }) => {
      if (!isRoomMember(socket, roomId) || typeof oldFileName !== "string" || typeof newFileName !== "string" || !/^[\w.\-]+$/.test(oldFileName) || !/^[\w.\-]+$/.test(newFileName)) return;

      socket.to(roomId).emit(
        "file-renamed",
        {
          oldFileName,
          newFileName,
        }
      );
    }
  );
  socket.on(
    "delete-file",
    ({ roomId, fileName }) => {
      if (!isRoomMember(socket, roomId) || typeof fileName !== "string" || !/^[\w.\-]+$/.test(fileName)) return;

      socket.to(roomId).emit(
        "file-deleted",
        { fileName }
      );
    }
  );

  socket.on("disconnect", () => {

    const videoRoomId = socket.videoRoomId;

    if (videoRoomId && videoRooms[videoRoomId]) {
      videoRooms[videoRoomId] = videoRooms[videoRoomId].filter(
        (user) => user.socketId !== socket.id
      );

      socket.to(videoRoomId).emit("video-user-left", {
        socketId: socket.id,
      });

      if (videoRooms[videoRoomId].length === 0) {
        delete videoRooms[videoRoomId];
      }
    }

    const roomId = socket.roomId;

    if (roomUsers[roomId]) {

      roomUsers[roomId] =
        roomUsers[roomId].filter(
          (user) =>
            user.socketId !== socket.id
        );

      emitRoomUsers(roomId);

      if (roomUsers[roomId].length === 0) {
        delete roomUsers[roomId];
      }
    }

    console.log(
      "User disconnected"
    );
  });
});

/* ---------------- RUN CODE ---------------- */

const { executeProgram, SUPPORTED_LANGUAGES } = require("./services/executor");

// Submitted code runs as a local child process with timeouts, an allowlisted
// environment and a per-run temp directory — but WITHOUT OS-level sandbox
// isolation. It is therefore disabled by default in production and must be
// opted into explicitly (ENABLE_CODE_EXECUTION=true) only on a host where
// that risk is acceptable (e.g. a locked-down container).
const executionEnabled =
  process.env.ENABLE_CODE_EXECUTION === "true" ||
  process.env.NODE_ENV !== "production";

app.post("/run", authenticateRequest, async (req, res) => {

  try {

    if (!executionEnabled) {
      return res.status(503).json({
        output:
          "Code execution is disabled on this deployment because it runs submitted code without OS-level sandbox isolation. Set ENABLE_CODE_EXECUTION=true only after arranging an isolated execution environment.",
        status: "execution_disabled",
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
      });
    }

    const { code, language, input } = req.body;

    if (typeof code !== "string" || code.length > 100000) {
      return res.status(400).json({
        output: "Code is required and must be smaller than 100 KB.",
      });
    }

    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({ output: "Unsupported language." });
    }

    if (input !== undefined && (typeof input !== "string" || input.length > 20000)) {
      return res.status(400).json({ output: "Program input must be smaller than 20 KB." });
    }

    const result = await executeProgram({ language, code, input });

    // Broadcast the output to the room (existing Socket.IO event contract).
    if (
      result.status === "success" &&
      typeof req.body.roomId === "string" &&
      /^[a-zA-Z0-9_-]{3,64}$/.test(req.body.roomId)
    ) {
      io.to(req.body.roomId).emit("code-output", { output: result.output });
    }

    // `output` keeps the original contract (what the UI renders); the extra
    // fields let clients distinguish compile errors, runtime errors and
    // timeouts without parsing text.
    res.json({
      output: result.output,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      output: "Execution Error",
    });
  }
});

/* ---------------- AI ROUTE ---------------- */

app.post("/ai", authenticateRequest, async (req, res) => {
  try {
    const {
      prompt,
      code = "",
      language = "javascript",
      chats = []
    } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ reply: "Please provide a valid question or prompt." });
    }

    console.log("[CodePilot Route] Request received:", prompt.trim().slice(0, 80));

    const result = await askCodePilot({
      prompt: prompt.trim(),
      code: typeof code === "string" ? code : "",
      language,
      chats: Array.isArray(chats) ? chats : [],
    });

    console.log("[CodePilot Route] Response source:", result.source, "model:", result.model);

    res.json({
      reply: result.reply,
      source: result.source,
      model: result.model,
    });
  } catch (error) {
    console.error("[CodePilot Route] Error:", error);
    res.status(500).json({
      reply: "CodePilot encountered an unexpected error. Please try again.",
    });
  }
});

/* ---------------- START SERVER ---------------- */

const PORT = Number(process.env.PORT) || 5000;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing server before starting another one.`);
    return;
  }

  console.error("Server failed to start:", error.message);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
