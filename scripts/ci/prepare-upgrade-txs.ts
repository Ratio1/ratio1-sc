import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { ethers, network, run, upgrades } from "hardhat";
import { DeployImplementationResponse } from "@openzeppelin/hardhat-upgrades/dist/deploy-implementation";

type UpgradeKind = "proxy" | "beacon";

interface UpgradeTarget {
  contract: string;
  target: string;
  kind: UpgradeKind;
}

interface SafeTransaction {
  to: string;
  value: string;
  data: string;
  operation: number;
  contractMethod: {
    name: string;
    payable: boolean;
    inputs: Array<{ name: string; type: string }>;
  };
  contractInputsValues: Record<string, string>;
}

interface UpgradeSummary {
  stage: string;
  network: string;
  chainId: number;
  safeAddress: string;
  generatedAt: string;
  upgrades: Array<{
    contract: string;
    target: string;
    kind: UpgradeKind;
    previousImplementation: string;
    newImplementation: string;
    proxyAdmin?: string;
    safeTransaction: SafeTransaction;
  }>;
  safeTxBuilder: {
    version: string;
    chainId: number;
    createdAt: string;
    meta: {
      stage: string;
      network: string;
    };
    safeAddress: string;
    transactions: SafeTransaction[];
  };
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
    if (!ethers.utils.isAddress(target)) {
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
  const stage = (process.env.UPGRADE_STAGE ?? network.name).toLowerCase();
  const outputDir =
    process.env.OUTPUT_DIR ?? path.join("safe-transactions", stage);
  const safeAddressEnv = process.env.SAFE_ADDRESS;
  if (!safeAddressEnv) {
    throw new Error("SAFE_ADDRESS environment variable must be provided");
  }

  const safeAddress = ethers.utils.getAddress(safeAddressEnv);
  const targets = parseTargets(process.env.UPGRADE_TARGETS);
  const timestamp = new Date().toISOString();
  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = providerNetwork.chainId;
  const verifySetting = (process.env.VERIFY_ON_ETHERSCAN ?? "").toLowerCase();
  const shouldVerify = ["1", "true", "yes"].includes(verifySetting);

  mkdirSync(outputDir, { recursive: true });

  const upgradesData: UpgradeSummary["upgrades"] = [];
  const safeTransactions: SafeTransaction[] = [];

  let proxyAdminContract:
    | Awaited<ReturnType<typeof upgrades.admin.getInstance>>
    | undefined;
  let proxyAdminAddress: string | undefined;

  for (const target of targets) {
    const targetAddress = ethers.utils.getAddress(target.target);
    console.log(`----------------------------------------------------`);
    console.log(
      `Preparing ${target.kind} upgrade for ${target.contract} at ${targetAddress}`
    );

    const factory = await ethers.getContractFactory(target.contract);

    let previousImplementation: string;
    let newImplementation: DeployImplementationResponse;
    let adminAddress: string | undefined;
    let safeTx: SafeTransaction;

    if (target.kind === "proxy") {
      if (!proxyAdminContract) {
        proxyAdminContract = await upgrades.admin.getInstance();
        proxyAdminAddress = ethers.utils.getAddress(proxyAdminContract.address);
      }

      previousImplementation = await upgrades.erc1967.getImplementationAddress(
        targetAddress
      );
      console.log(`Previous implementation: ${previousImplementation}`);

      newImplementation = await upgrades.prepareUpgrade(targetAddress, factory);
      if (newImplementation === previousImplementation) {
        console.log(
          `🔄 New implementation is the same as the previous one for ${target.contract} at ${targetAddress}. Skipping...`
        );
        continue;
      }

      console.log(`✅ New implementation deployed at: ${newImplementation}`);

      adminAddress = proxyAdminAddress;

      const data = proxyAdminContract!.interface.encodeFunctionData("upgrade", [
        targetAddress,
        newImplementation,
      ]);

      safeTx = {
        to: proxyAdminAddress!,
        value: "0",
        data,
        operation: 0,
        contractMethod: {
          name: "upgrade",
          payable: false,
          inputs: [
            { name: "proxy", type: "address" },
            { name: "implementation", type: "address" },
          ],
        },
        contractInputsValues: {
          proxy: targetAddress,
          implementation: newImplementation.toString(),
        },
      };
    } else {
      const beacon = await ethers.getContractAt(
        "UpgradeableBeacon",
        targetAddress
      );
      previousImplementation = await beacon.implementation();
      console.log(`Previous implementation: ${previousImplementation}`);

      newImplementation = await upgrades.prepareUpgrade(
        targetAddress,
        factory,
        {
          kind: "beacon",
        }
      );
      if (newImplementation === previousImplementation) {
        console.log(
          `🔄 New implementation is the same as the previous one for ${target.contract} at ${targetAddress}. Skipping...`
        );
        continue;
      }

      console.log(`✅ New implementation deployed at: ${newImplementation}`);

      const data = beacon.interface.encodeFunctionData("upgradeTo", [
        newImplementation.toString(),
      ]);

      safeTx = {
        to: targetAddress,
        value: "0",
        data,
        operation: 0,
        contractMethod: {
          name: "upgradeTo",
          payable: false,
          inputs: [{ name: "newImplementation", type: "address" }],
        },
        contractInputsValues: {
          newImplementation: newImplementation.toString(),
        },
      };
    }

    if (shouldVerify) {
      try {
        console.log(
          `Verifying implementation for ${target.contract} on block explorer`
        );
        await run("verify:verify", {
          address: newImplementation,
          constructorArguments: [],
        });
        console.log(`Verification successful for ${newImplementation}`);
      } catch (error) {
        console.warn(
          `Verification skipped or failed for ${newImplementation}:`,
          (error as Error).message ?? error
        );
      }
    }

    upgradesData.push({
      contract: target.contract,
      target: targetAddress,
      kind: target.kind,
      previousImplementation,
      newImplementation: newImplementation.toString(),
      proxyAdmin: adminAddress,
      safeTransaction: safeTx,
    });

    safeTransactions.push(safeTx);
  }

  const summary: UpgradeSummary = {
    stage,
    network: network.name,
    chainId,
    safeAddress,
    generatedAt: timestamp,
    upgrades: upgradesData,
    safeTxBuilder: {
      version: "1.0",
      chainId,
      createdAt: timestamp,
      meta: {
        stage,
        network: network.name,
      },
      safeAddress,
      transactions: safeTransactions,
    },
  };

  const filePath = path.join(outputDir, `upgrade-${stage}-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify(summary, null, 2));
  console.log(`Upgrade data written to ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
