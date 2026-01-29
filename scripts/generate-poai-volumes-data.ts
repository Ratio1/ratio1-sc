import { readFileSync } from "fs";
import path from "path";
import { Interface } from "ethers";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function toUtcMs(dateString: string): number {
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date string: "${dateString}"`);
  }
  return Date.UTC(year, month - 1, day);
}

function diffDaysUtc(fromDate: string, toDate: string): number {
  const diffMs = toUtcMs(fromDate) - toUtcMs(toDate);
  if (diffMs % MS_PER_DAY !== 0) {
    throw new Error(`Date difference is not a whole number of days: ${fromDate} vs ${toDate}`);
  }
  return diffMs / MS_PER_DAY;
}

function parseBigInt(value: string, label: string): bigint {
  if (!value) {
    throw new Error(`Missing value for ${label}`);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid numeric value for ${label}: "${value}"`);
  }
  return BigInt(value);
}

function main() {
  const inputPath = process.argv[2] ?? path.join(process.cwd(), "stats.csv");
  const baseDate = process.env.BASE_DATE ?? "2026-01-28";
  const baseEpoch = parseBigInt(process.env.BASE_EPOCH ?? "249", "BASE_EPOCH");

  const rawCsv = readFileSync(inputPath, "utf8");
  const lines = rawCsv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("stats.csv must include a header row and at least one data row");
  }

  const headers = parseCsvLine(lines[0]).map((value) => value.replace(/^"|"$/g, ""));
  const timestampIndex = headers.indexOf("creation_timestamp");
  const totalRewardsIndex = headers.indexOf("total_poai_rewards");

  if (timestampIndex === -1) {
    throw new Error("Column 'creation_timestamp' not found in stats.csv");
  }
  if (totalRewardsIndex === -1) {
    throw new Error("Column 'total_poai_rewards' not found in stats.csv");
  }

  const epochs: bigint[] = [];
  const totals: bigint[] = [];

  let previousEpoch: bigint | null = null;
  let previousTotal: bigint | null = null;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]).map((value) => value.replace(/^"|"$/g, ""));
    if (values.length !== headers.length) {
      throw new Error(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
    }

    const timestamp = values[timestampIndex];
    const datePart = timestamp.split(" ")[0];
    if (!datePart) {
      throw new Error(`Missing date value at row ${i + 1}`);
    }

    const dayOffset = diffDaysUtc(datePart, baseDate);
    const epoch = baseEpoch + BigInt(dayOffset);

    const totalRewards = parseBigInt(values[totalRewardsIndex], "total_poai_rewards");
    const numerator = totalRewards * 100n;
    if (numerator % 85n !== 0n) {
      throw new Error(
        `Non-integer volume at row ${i + 1} (${datePart}): total_poai_rewards ${totalRewards} not divisible by 85`
      );
    }
    const volumeTotal = numerator / 85n;

    if (previousEpoch !== null && epoch !== previousEpoch + 1n) {
      throw new Error(
        `Epochs are not contiguous at row ${i + 1}: ${previousEpoch} -> ${epoch}`
      );
    }
    if (previousTotal !== null && volumeTotal < previousTotal) {
      throw new Error(
        `Volume totals are not increasing at row ${i + 1}: ${previousTotal} -> ${volumeTotal}`
      );
    }

    epochs.push(epoch);
    totals.push(volumeTotal);
    previousEpoch = epoch;
    previousTotal = volumeTotal;
  }

  const iface = new Interface([
    "function initializePoaiVolumes(uint256[] epochs, uint256[] totals)",
  ]);
  const data = iface.encodeFunctionData("initializePoaiVolumes", [epochs, totals]);

  console.log(`Loaded ${epochs.length} epochs from ${inputPath}`);
  console.log(`Epoch range: ${epochs[0]} -> ${epochs[epochs.length - 1]}`);
  console.log(`Total volume: ${totals[totals.length - 1]}`);
  console.log("---");
  console.log("data field:");
  console.log(data);
}

main();
