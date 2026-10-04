import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import process from "node:process";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import uploadRoutes from "./routes/uploads.js";
import catalogRoutes from "./routes/catalog.js";
import path from "path";
import { fileURLToPath } from "url";
import orderRoutes from "./routes/orders.js";
import cartRoutes from "./routes/cart.js";
import { connectMongo } from "./config/db.js";
import { startSystemBackupScheduler } from "./services/backupService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env"), quiet: true });

const isVerbose = process.env.DEBUG_API === "true" || process.env.VERBOSE === "true";
const requiredEnvs = ["JWT_SECRET", ...(process.env.VERCEL === "1" ? ["MONGO_URI"] : [])];
const missingEnvs = requiredEnvs.filter((envName) => !process.env[envName]);
if (missingEnvs.length) {
  console.error(`[env] Missing required environment variables: ${missingEnvs.join(", ")}`);
}

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5000;

if (isVerbose) {
  app.use((req, res, next) => {
    console.info(`[api] ${req.method} ${req.originalUrl}`);
    next();
  });
}

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const getHealthModel = () => {
  const readyStates = [
    "disconnected",
    "connected",
    "connecting",
    "disconnecting",
    "uninitialized",
  ];
  const mongoState = mongoose.connection.readyState;
  const dbConnected = mongoState === 1;
  return {
    status: dbConnected ? "online" : "offline",
    dbConnected,
    databaseState: readyStates[mongoState] || "unknown",
    timestamp: new Date().toISOString(),
    message: dbConnected
      ? "Backend and database are connected"
      : "Backend is running but the database is unavailable",
  };
};

app.get("/", (req, res) => {
  return res.json({ ...getHealthModel(), message: "Backend is running" });
});

app.get("/api/health", (req, res) => {
  return res.json(getHealthModel());
});

app.use("/api", (req, res, next) => {
  if (missingEnvs.length) {
    return res.status(503).json({
      success: false,
      message: "Backend configuration is incomplete.",
      missingEnvironmentVariables: missingEnvs,
    });
  }

  if (mongoose.connection.readyState === 1) {
    return next();
  }

  return res.status(503).json({
    success: false,
    message:
      "Backend is running, but MongoDB is not connected. Verify MONGO_URI and database network access.",
    health: getHealthModel(),
  });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/catalog", catalogRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  if (err.name === "MulterError") {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File size exceeds 5MB limit"
        : "Invalid file type: only JPEG, PNG, WEBP, and GIF are allowed";
    return res.status(400).json({ success: false, message });
  }

  console.error("[error]", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

const shutdown = (reason, error) => {
  console.error(`Shutdown: ${reason}`);
  if (error) {
    console.error(error);
  }
  process.exit(1);
};

const connectWithRetry = async (attempt = 1) => {
  if (process.env.VERCEL === "1" && !process.env.MONGO_URI) {
    return;
  }

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return;
  }

  try {
    await connectMongo();
    if (isVerbose) console.log("Connected to MongoDB");
    if (process.env.VERCEL !== "1") startSystemBackupScheduler();
  } catch (error) {
    const delayMs = Math.min(30000, 2000 * attempt);
    console.error(
      `MongoDB connection error. Retrying in ${Math.round(delayMs / 1000)}s.`,
      error.message
    );
    setTimeout(() => connectWithRetry(attempt + 1), delayMs);
  }
};

app.listen(PORT, () => {
  if (isVerbose) {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`API base URL: http://localhost:${PORT}/api`);
  }
  connectWithRetry();
});

process.on("uncaughtException", (error) => {
  shutdown("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  shutdown("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("SIGINT", () => {
  if (isVerbose) console.log("Received SIGINT, shutting down gracefully.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (isVerbose) console.log("Received SIGTERM, shutting down gracefully.");
  process.exit(0);
});
