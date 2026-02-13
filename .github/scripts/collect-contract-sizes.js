#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function deployedBytecodeSize(deployedBytecode) {
  if (typeof deployedBytecode !== "string" || !deployedBytecode.startsWith("0x")) {
    return 0;
  }
  return Math.max((deployedBytecode.length - 2) / 2, 0);
}

function walkJsonFiles(rootDir, acc = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(fullPath, acc);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".json") || entry.name.endsWith(".dbg.json")) {
      continue;
    }
    acc.push(fullPath);
  }
  return acc;
}

function collectContractSizes(artifactsPath) {
  const byContract = {};
  const files = walkJsonFiles(artifactsPath);
  for (const file of files) {
    let artifact;
    try {
      artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_error) {
      continue;
    }
    const contractName = artifact?.contractName;
    if (typeof contractName !== "string" || contractName.length === 0) {
      continue;
    }
    const size = deployedBytecodeSize(artifact?.deployedBytecode);
    if (!Number.isFinite(size) || size <= 0) {
      continue;
    }
    if (byContract[contractName] === undefined || size > byContract[contractName]) {
      byContract[contractName] = size;
    }
  }
  return byContract;
}

function main() {
  const args = parseArgs(process.argv);
  const artifactsDir = path.resolve(args.artifacts || "artifacts/contracts");
  const outputPath = path.resolve(args.out || "contract-sizes.json");

  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifacts directory not found at ${artifactsDir}`);
  }

  const sizes = collectContractSizes(artifactsDir);
  fs.writeFileSync(outputPath, `${JSON.stringify(sizes, null, 2)}\n`, "utf8");
}

main();
