import fs from "fs";
import path from "path";

export type ModelPrice = {
  model: string;
  price: number;
  unit: string;
};

export type PricingSnapshot = {
  date: string;
  prices: ModelPrice[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const PRICING_FILE = path.join(DATA_DIR, "replicate-pricing.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(PRICING_FILE)) {
    fs.writeFileSync(PRICING_FILE, "[]", "utf-8");
  }
}

export function getPricingSnapshots(): PricingSnapshot[] {
  ensureFile();

  try {
    const data = fs.readFileSync(PRICING_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function savePricingSnapshot(
  snapshot: PricingSnapshot
) {
  ensureFile();

  const snapshots = getPricingSnapshots();

  const existingIndex = snapshots.findIndex(
    (item) => item.date === snapshot.date
  );

  if (existingIndex >= 0) {
    snapshots[existingIndex] = snapshot;
  } else {
    snapshots.push(snapshot);
  }

  fs.writeFileSync(
    PRICING_FILE,
    JSON.stringify(snapshots, null, 2),
    "utf-8"
  );
}

export function getTodayPricing(): PricingSnapshot | null {
  const today = new Date()
    .toISOString()
    .split("T")[0];

  const snapshots = getPricingSnapshots();

  return (
    snapshots.find(
      (snapshot) => snapshot.date === today
    ) ?? null
  );
}