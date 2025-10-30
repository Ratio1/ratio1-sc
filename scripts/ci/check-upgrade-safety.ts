import { ethers, upgrades, run } from "hardhat";

type UpgradeKind = "proxy" | "beacon";

interface UpgradeTarget {
  contract: string;
  target: string;
  kind: UpgradeKind;
}

function parseTargets(rawTargets: string | undefined): UpgradeTarget[] {
  if (!rawTargets) {
    return [];
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
    const kind = (kindRaw?.toLowerCase() as UpgradeKind | undefined) ?? "proxy";

    if (kind !== "proxy" && kind !== "beacon") {
      throw new Error(
        `Invalid upgrade kind "${kindRaw}" in entry "${trimmed}". Supported kinds: proxy, beacon.`
      );
    }

    targets.push({
      contract,
      target: ethers.getAddress(target),
      kind,
    });
  }

  return targets;
}

async function validateProxyUpgrade(
  proxyAddress: string,
  contractName: string
) {
  const factory = await getContractFactory(contractName);
  console.log(`Validating proxy upgrade for ${contractName} @ ${proxyAddress}`);

  const currentImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log(`- Current implementation: ${currentImpl}`);

  await upgrades.validateUpgrade(proxyAddress, factory);
  console.log(`✅ ${contractName} proxy upgrade is safe\n`);
}

async function validateBeaconUpgrade(
  beaconAddress: string,
  contractName: string
) {
  const factory = await getContractFactory(contractName);
  console.log(
    `Validating beacon upgrade for ${contractName} @ ${beaconAddress}`
  );

  const beacon = await ethers.getContractAt(
    "UpgradeableBeacon",
    beaconAddress
  );
  const currentImpl = await beacon.implementation();
  console.log(`- Current implementation: ${currentImpl}`);

  await upgrades.validateUpgrade(beaconAddress, factory, { kind: "beacon" });
  console.log(`✅ ${contractName} beacon upgrade is safe\n`);
}

async function getContractFactory(contractName: string) {
  const signer = await getSigner();
  return ethers.getContractFactory(contractName, signer);
}

async function getSigner() {
  try {
    const signers = await ethers.getSigners();
    if (signers.length > 0) {
      return signers[0];
    }
  } catch {
    // ignore and fallback to random wallet
  }

  return ethers.Wallet.createRandom().connect(ethers.provider);
}

async function main() {
  const stage = (process.env.UPGRADE_STAGE ?? "pr").toLowerCase();
  const targets = parseTargets(process.env.UPGRADE_TARGETS);

  console.log(
    `Running upgrade safety validation for stage "${stage}" with ${targets.length} target(s)`
  );

  if (targets.length === 0) {
    console.log("No upgrade targets detected. Skipping validation.");
    return;
  }

  await run("compile");

  const errors: string[] = [];

  for (const target of targets) {
    try {
      if (target.kind === "beacon") {
        await validateBeaconUpgrade(target.target, target.contract);
      } else {
        await validateProxyUpgrade(target.target, target.contract);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error(`❌ Validation failed for ${target.contract}: ${message}`);
      errors.push(
        `${target.contract} @ ${target.target} validation failed: ${message}`
      );
    }
  }

  if (errors.length > 0) {
    console.error("\nUpgrade safety validation failed:");
    for (const error of errors) {
      console.error(` - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("All upgrade targets validated successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
