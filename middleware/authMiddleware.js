const jwt = require("jsonwebtoken");

const authenticateRequest = (request, response, next) => {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return response.status(401).json({ message: "Authentication required" });
  }

  try {
    request.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return response.status(401).json({ message: "Invalid or expired token" });
  }
};

const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
};

module.exports = { authenticateRequest, authenticateSocket };
