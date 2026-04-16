require("dotenv").config();
const connectDB = require("../config/db");
const AuthorizedPerson = require("../models/AuthorizedPerson");

const main = async () => {
  try {
    await connectDB();

    console.log("Connected to MongoDB, checking AuthorizedPerson indexes...");

    const currentIndexes = await AuthorizedPerson.collection.indexes();
    const firebaseIndex = currentIndexes.find((index) => index.name === "firebaseUid_1");

    if (firebaseIndex) {
      console.log("Found stale firebaseUid_1 index:", firebaseIndex);
      await AuthorizedPerson.collection.dropIndex("firebaseUid_1");
      console.log("Dropped stale firebaseUid_1 index.");
    } else {
      console.log("No stale firebaseUid_1 index found.");
    }

    const result = await AuthorizedPerson.syncIndexes();
    console.log("SyncIndexes result:", result);
  } catch (error) {
    console.error("Failed to fix AuthorizedPerson indexes:", error);
    process.exit(1);
  } finally {
    await require("mongoose").connection.close();
    console.log("MongoDB connection closed.");
    process.exit(0);
  }
};

main();
