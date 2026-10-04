import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const sourceUri = process.env.LOCAL_MONGO_URI;
const targetUri = process.env.ATLAS_MONGO_URI || process.env.MONGO_URI;

if (!sourceUri || !targetUri) {
  throw new Error("Set LOCAL_MONGO_URI and the Atlas target MONGO_URI before running this migration.");
}

let source;
let target;

try {
  source = await mongoose.createConnection(sourceUri, {
    serverSelectionTimeoutMS: 15000,
  }).asPromise();
  target = await mongoose.createConnection(targetUri, {
    serverSelectionTimeoutMS: 15000,
  }).asPromise();

  if (source.name !== target.name) {
    throw new Error(`Database names differ: local=${source.name}, Atlas=${target.name}.`);
  }

  const sourceCollections = (await source.db.listCollections().toArray())
    .filter(({ name }) => !name.startsWith("system."));
  const targetCollections = (await target.db.listCollections().toArray())
    .filter(({ name }) => !name.startsWith("system."));
  const targetDocumentCount = await Promise.all(
    targetCollections.map(({ name }) => target.db.collection(name).countDocuments())
  ).then((counts) => counts.reduce((total, count) => total + count, 0));

  if (targetDocumentCount > 0 && process.env.ATLAS_MIGRATION_RESUME !== "true") {
    throw new Error(
      "The Atlas database already contains documents. Set ATLAS_MIGRATION_RESUME=true only to resume this migration."
    );
  }

  for (const { name } of sourceCollections) {
    const sourceCollection = source.db.collection(name);
    const targetCollection = target.db.collection(name);
    const indexes = (await sourceCollection.indexes())
      .filter(({ name: indexName }) => indexName !== "_id_")
      .map(({ ns, v, ...index }) => index);

    if (indexes.length) await targetCollection.createIndexes(indexes);

    let batch = [];
    let copiedCount = 0;
    for await (const document of sourceCollection.find({})) {
      batch.push({
        replaceOne: {
          filter: { _id: document._id },
          replacement: document,
          upsert: true,
        },
      });

      if (batch.length === 250) {
        await targetCollection.bulkWrite(batch, { ordered: false });
        copiedCount += batch.length;
        batch = [];
      }
    }

    if (batch.length) {
      await targetCollection.bulkWrite(batch, { ordered: false });
      copiedCount += batch.length;
    }

    console.log(`${name}: copied ${copiedCount} documents`);
  }

  console.log(`Migration complete: ${sourceCollections.length} collections copied to ${target.name}.`);
} catch (error) {
  let message = error?.message || "Unknown migration error";
  if (sourceUri) message = message.replaceAll(sourceUri, "[local Mongo URI]");
  if (targetUri) message = message.replaceAll(targetUri, "[Atlas Mongo URI]");
  console.error("Atlas migration failed:", message);
  process.exitCode = 1;
} finally {
  await Promise.all([source?.close(), target?.close()]);
}