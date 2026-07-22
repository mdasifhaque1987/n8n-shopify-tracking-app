import "dotenv/config";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import db from "../app/db.server.js";
import { processNextOrderJob } from "../app/services/shopify-order-worker.server";

const workerId = `order-worker-${randomUUID()}`;
const pollMs = Math.max(250, Number(process.env.ORDER_WORKER_POLL_MS || 2000));
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

while (!stopping) {
  try {
    const processed = await processNextOrderJob(workerId);
    if (!processed) await delay(pollMs);
  } catch (error) {
    console.error("Order worker cycle failed", {
      category: error instanceof Error ? error.name : "unknown_worker_error",
    });
    await delay(pollMs);
  }
}

await db.$disconnect();
