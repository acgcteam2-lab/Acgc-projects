import mongoose from "mongoose";
import process from "node:process";

mongoose.set("strictQuery", true);

let connectionPromise;
let lastConnectionError = null;

export const hasMongoUri = () => Boolean(process.env.MONGO_URI?.trim());

export const getLastMongoError = () => lastConnectionError;

const getCleanMongoUri = (uri) =>
  uri
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");

const validateMongoUri = (uri) => {
  if (!uri) {
    throw new Error("Missing MongoDB URI. Provide MONGO_URI in .env or run local MongoDB on 127.0.0.1:27017.");
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MONGO_URI scheme. Expected a MongoDB connection URI.");
  }

  return uri;
};

const getMongoUri = () => {
  const configuredUri = process.env.MONGO_URI?.trim();
  if (!configuredUri && process.env.VERCEL === "1") {
    throw new Error("MONGO_URI is not configured.");
  }
  if (!configuredUri) {
    console.warn(
      "[db] MONGO_URI not set. Falling back to local MongoDB at mongodb://127.0.0.1:27017/reactvite"
    );
  }
  return getCleanMongoUri(configuredUri || "mongodb://127.0.0.1:27017/reactvite");
};

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) {
    lastConnectionError = null;
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = Promise.resolve()
      .then(() => mongoose.connect(validateMongoUri(getMongoUri()), {
        autoIndex: true,
        serverSelectionTimeoutMS: 8000,
      }))
      .then((connection) => {
        lastConnectionError = null;
        console.info("MongoDB connected");
        return connection;
      })
      .catch((error) => {
        const errorMessage = (error.message || String(error)).replace(
          /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
          "[redacted MongoDB URI]"
        );
        lastConnectionError = errorMessage;
        console.error("MongoDB connection error:", errorMessage);
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}
