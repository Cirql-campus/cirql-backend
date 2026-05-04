"use strict";

// ─── Load env FIRST before any other import ─────────────────────────────────
const dotenv = require("dotenv");
dotenv.config();

// Validate environment — exits immediately if anything is missing
require("./utils/validateEnv")();

const cluster = require("cluster");
const os = require("os");
const logger = require("./utils/logger");
const shouldUseCluster =
  process.env.NODE_ENV === "production" &&
  process.env.DISABLE_CLUSTER !== "true";
const jobs = require("./lib/cron");
jobs.start();

// ─── FIX CRASH-1 & CRASH-2 ──────────────────────────────────────────────────
// The original code created `app` and `server` at module scope, meaning BOTH
// the master process and every worker would run that code. The master then tried
// to use @socket.io/sticky's setupMaster on a plain http.createServer() that had
// no Express app attached — so every request went nowhere.
//
// Correct pattern:
//   Master  → plain http server, just routes TCP connections to workers
//   Workers → full Express app + Socket.io
// ─────────────────────────────────────────────────────────────────────────────

if (cluster.isPrimary && shouldUseCluster) {
  // ── PRIMARY PROCESS ───────────────────────────────────────────────────────
  const http = require("http");
  const { setupMaster } = require("@socket.io/sticky");
  const { setupPrimary } = require("@socket.io/cluster-adapter");

  const PORT = parseInt(process.env.PORT, 10) || 5000;

  // The master creates a plain HTTP server that only does sticky-session routing.
  // It never processes requests itself — it just forwards TCP sockets to workers.
  const httpServer = http.createServer();

  setupMaster(httpServer, { loadBalancingMethod: "least-connection" });
  setupPrimary();
  cluster.setupPrimary({ serialization: "advanced" });

  httpServer.listen(PORT, () => {
    logger.info(
      `🚀 CirQl Master ${process.pid} listening on port ${PORT} [${process.env.NODE_ENV}]`,
    );
  });

  const numCPUs = os.cpus().length;
  for (let i = 0; i < numCPUs; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    logger.warn(
      `Worker ${worker.process.pid} died (code=${code} signal=${signal}). Restarting…`,
    );
    cluster.fork();
  });
} else {
  // ── WORKER PROCESS ────────────────────────────────────────────────────────
  // Full Express app lives ONLY in worker processes.
  const express = require("express");
  const http = require("http");
  const cors = require("cors");
  const helmet = require("helmet");
  const morgan = require("morgan");
  const compression = require("compression");
  const mongoSanitize = require("express-mongo-sanitize");
  const xss = require("xss");
  const hpp = require("hpp");
  const cookieParser = require("cookie-parser");

  const connectDB = require("./config/db");
  const { initSocket } = require("./config/socket");
  const { generalLimiter } = require("./middleware/rateLimit.middleware");
  const { assignRequestId } = require("./middleware/requestId.middleware");
  const requestTimeout = require("./middleware/requestTimeout.middleware");
  const { protect } = require("./middleware/auth.middleware");
  const { admin } = require("./middleware/admin.middleware");
  const {
    csrfProtect,
    csrfTokenRoute,
  } = require("./middleware/csrf.middleware");

  const authRoutes = require("./routes/auth.routes");
  const listingRoutes = require("./routes/listing.routes");
  const userRoutes = require("./routes/user.routes");
  const chatRoutes = require("./routes/chat.routes");
  const notificationRoutes = require("./routes/notification.routes");
  const adminRoutes = require("./routes/admin.routes");
  const categoryRoutes = require("./routes/category.routes");
  const dealRoutes = require("./routes/deal.routes");
  const wantedRoutes = require("./routes/wanted.routes");

  const app = express();
  const server = http.createServer(app);

  // ── Database ───────────────────────────────────────────────────────────────
  connectDB();

  // ── Socket.io (with cluster adapter) ──────────────────────────────────────
  const io = initSocket(server);
  if (shouldUseCluster) {
    const { setupWorker } = require("@socket.io/sticky");
    setupWorker(io);
  }

  // ── Allowed CORS origins ──────────────────────────────────────────────────
  const allowedOrigins = (
    process.env.FRONTEND_ORIGINS || "http://localhost:5173"
  )
    .split(",")
    .map((o) => o.trim());

  // ── Security headers ───────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      permittedCrossDomainPolicies: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use((req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(
          Object.assign(new Error(`CORS: origin "${origin}" not allowed`), {
            status: 403,
          }),
        );
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "X-CSRF-Token",
      ],
      maxAge: 86400,
    }),
  );

  // ── Compression ────────────────────────────────────────────────────────────
  app.use(compression());

  // ── Request ID + logging ───────────────────────────────────────────────────
  app.use(assignRequestId);
  app.use(requestTimeout(Number(process.env.REQUEST_TIMEOUT_MS || 30000)));
  morgan.token("id", (req) => req.requestId);
  if (process.env.NODE_ENV !== "production") {
    app.use(
      morgan(
        "[:id] :method :url :status :res[content-length] - :response-time ms",
        { stream: logger.stream },
      ),
    );
  } else {
    app.use(
      morgan(
        '[:id] :remote-addr ":method :url HTTP/:http-version" :status :res[content-length]',
        { stream: logger.stream },
      ),
    );
  }

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: "512kb" }));
  app.use(express.urlencoded({ extended: true, limit: "512kb" }));
  app.use(cookieParser());

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({
        success: false,
        message: "Malformed JSON request body",
        requestId: req.requestId,
      });
    }
    next(err);
  });

  // ── Input sanitisation ─────────────────────────────────────────────────────
  app.use(mongoSanitize());
  app.use((req, _res, next) => {
    const sanitize = (value) => {
      if (typeof value === "string") return xss(value);
      if (Array.isArray(value)) return value.map(sanitize);
      if (value && typeof value === "object") {
        Object.keys(value).forEach((key) => {
          value[key] = sanitize(value[key]);
        });
      }
      return value;
    };

    sanitize(req.body);
    sanitize(req.query);
    sanitize(req.params);
    next();
  });
  app.use(hpp({ whitelist: ["sort", "category", "type"] }));
  app.get("/api/v1/auth/csrf-token", csrfTokenRoute);
  app.use(csrfProtect);

  // ── Global rate limiter ────────────────────────────────────────────────────
  app.use(generalLimiter);

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", (req, res) => {
    const mongoose = require("mongoose");
    const { isRedisEnabled, getRedisClient } = require("./utils/redis");
    const isOk = mongoose.connection.readyState === 1;

    const publicPayload = {
      status: isOk ? "ok" : "down",
      timestamp: new Date().toISOString(),
    };

    const secret = process.env.HEALTH_CHECK_SECRET;
    const provided = req.headers["x-health-secret"] || req.query.secret;
    if (secret && provided === secret) {
      const redisClient = getRedisClient();
      return res.status(isOk ? 200 : 503).json({
        ...publicPayload,
        uptime: Math.round(process.uptime()),
        database: isOk ? "connected" : "disconnected",
        redis: isRedisEnabled()
          ? redisClient?.isOpen
            ? "connected"
            : "configured_not_connected"
          : "disabled",
      });
    }

    res.status(isOk ? 200 : 503).json(publicPayload);
  });

  // ── Backward-compat redirect /api → /api/v1 ────────────────────────────────
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/v1")) return next();
    res.redirect(308, `/api/v1${req.path}`);
  });

  // ── API Routes ─────────────────────────────────────────────────────────────
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/listings", listingRoutes);
  app.use("/api/v1/users", userRoutes);
  app.use("/api/v1/chat", chatRoutes);
  app.use("/api/v1/deals", dealRoutes);
  app.use("/api/v1/wanted", wantedRoutes);
  app.use("/api/v1/notifications", notificationRoutes);
  app.use("/api/v1/admin", protect, admin, adminRoutes);
  app.use("/api/v1/categories", categoryRoutes);

  // ── 404 ────────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Route not found" });
  });

  // ── Global error handler ───────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const isProduction = process.env.NODE_ENV === "production";
    const showDebug = process.env.DEBUG_ERRORS === "true" && !isProduction;
    const status = err.status || err.statusCode || 500;
    const message =
      status >= 500 && isProduction
        ? "Internal server error"
        : err.message || "Internal server error";
    if (status >= 500) {
      logger.error(
        `[${req.requestId || "system"}] Global Error: ${err.message}`,
        err,
      );
    }
    res.status(status).json({
      success: false,
      message,
      requestId: req.requestId,
      ...(showDebug && { stack: err.stack }),
    });
  });

  // Worker listens on a random port in cluster mode; dev listens on PORT directly.
  const listenPort = shouldUseCluster
    ? 0
    : parseInt(process.env.PORT, 10) || 5000;
  const listenHost = shouldUseCluster ? "localhost" : undefined;
  server.listen(listenPort, listenHost, () => {
    const addr = server.address();
    logger.info(
      `Server ${process.pid} listening on ${addr.address || "0.0.0.0"}:${addr.port}`,
    );
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // FIX BUG-3: mongoose.connection.close() in Mongoose 8 returns a Promise directly
  const gracefulShutdown = (signal) => {
    logger.info(`\n${signal} received — shutting down worker ${process.pid}…`);
    server.close(async () => {
      logger.info("HTTP server closed.");
      try {
        await require("mongoose").connection.close(false);
        logger.info("MongoDB connection closed.");
        process.exit(0);
      } catch (err) {
        logger.error(`Error closing MongoDB: ${err.message}`);
        process.exit(1);
      }
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error(`[UNHANDLED REJECTION] ${reason}`);
    if (process.env.NODE_ENV !== "production") process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    logger.error(`[UNCAUGHT EXCEPTION] ${err.message}`);
    gracefulShutdown("uncaughtException");
  });

  module.exports = { app, server };
}
