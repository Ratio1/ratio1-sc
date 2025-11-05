import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { artifacts, ethers } from "hardhat";

type UpgradeKind = "proxy" | "beacon";

interface UpgradeTarget {
  contract: string;
  target: string;
  kind: UpgradeKind;
}

function parseTargets(rawTargets: string | undefined): UpgradeTarget[] {
  if (!rawTargets) {
    throw new Error("UPGRADE_TARGETS environment variable must be provided");
  }

  const targets: UpgradeTarget[] = [];
  for (const entry of rawTargets.split(/[,\n]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(":").map((value) => value.trim());
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(
        `Invalid target entry: "${trimmed}". Expected format ContractName:0xAddress[:proxy|beacon]`
      );
    }
    const [contract, target, kindRaw] = parts;
    const kind = kindRaw ? (kindRaw.toLowerCase() as UpgradeKind) : "proxy";
    if (kind !== "proxy" && kind !== "beacon") {
      throw new Error(
        `Invalid upgrade kind "${kindRaw}" in entry "${trimmed}". Supported kinds: proxy, beacon.`
      );
    }
    if (!ethers.isAddress(target)) {
      throw new Error(`Invalid address "${target}" in entry "${trimmed}"`);
    }
    targets.push({ contract, target, kind });
  }

  if (targets.length === 0) {
    throw new Error("No upgrade targets parsed from UPGRADE_TARGETS");
  }

  return targets;
}

async function main() {
  const outputDir =
    process.env.ABI_OUTPUT_DIR ?? path.join("safe-transactions", "abis");
  const targets = parseTargets(process.env.UPGRADE_TARGETS);

  const uniqueContracts = new Set(targets.map((target) => target.contract));
  const resolvedOutputDir = path.resolve(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });

  for (const contractName of uniqueContracts) {
    const artifact = await artifacts.readArtifact(contractName);
    const abiPath = path.join(resolvedOutputDir, `${contractName}.json`);
    writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log(`ABI written to ${abiPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
