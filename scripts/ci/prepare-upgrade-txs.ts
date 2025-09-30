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
  contractMethod: {
    name: string;
    payable: boolean;
    inputs: Array<{ name: string; type: string }>;
  };
  contractInputsValues: Record<string, string>;
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

async function resolveImplementationAddress(
  result: DeployImplementationResponse
): Promise<string> {
  if (typeof result === "string") {
    return ethers.getAddress(result);
  }

  const receipt = await result.wait();
  const address = receipt?.contractAddress ?? result.to;

  if (!address) {
    throw new Error(
      "Could not determine implementation address from deployment response"
    );
  }

  return ethers.getAddress(address);
}

async function main() {
  const stage = (process.env.UPGRADE_STAGE ?? network.name).toLowerCase();
  const outputDir =
    process.env.OUTPUT_DIR ?? path.join("safe-transactions", stage);
  const safeAddressEnv = process.env.SAFE_ADDRESS;
  if (!safeAddressEnv) {
    throw new Error("SAFE_ADDRESS environment variable must be provided");
  }

  const safeAddress = ethers.getAddress(safeAddressEnv);
  const targets = parseTargets(process.env.UPGRADE_TARGETS);
  const providerNetwork = await ethers.provider.getNetwork();
  const chainId = providerNetwork.chainId;
  const verifySetting = (process.env.VERIFY_ON_ETHERSCAN ?? "").toLowerCase();
  const shouldVerify = ["1", "true", "yes"].includes(verifySetting);
  const createdAt = Date.now();

  mkdirSync(outputDir, { recursive: true });

  const safeTransactions: SafeTransaction[] = [];

  let proxyAdminContract:
    | Awaited<ReturnType<typeof upgrades.erc1967.getAdminAddress>>
    | undefined;
  let proxyAdminAddress: string | undefined;

  for (const target of targets) {
    const targetAddress = ethers.getAddress(target.target);
    console.log(`----------------------------------------------------`);
    console.log(
      `Preparing ${target.kind} upgrade for ${target.contract} at ${targetAddress}`
    );

    const factory = await ethers.getContractFactory(target.contract);

    let previousImplementation: string;
    let newImplementation: DeployImplementationResponse;
    let newImplementationAddress: string;
    let safeTx: SafeTransaction;

    if (target.kind === "proxy") {
      if (!proxyAdminContract) {
        proxyAdminContract = await upgrades.erc1967.getAdminAddress(
          targetAddress
        );
        proxyAdminAddress = proxyAdminContract;
      }

      previousImplementation = await upgrades.erc1967.getImplementationAddress(
        targetAddress
      );
      console.log(`Previous implementation: ${previousImplementation}`);

      newImplementation = await upgrades.prepareUpgrade(targetAddress, factory);
      newImplementationAddress = await resolveImplementationAddress(
        newImplementation
      );

      if (
        ethers.getAddress(previousImplementation) === newImplementationAddress
      ) {
        console.log(
          `🔄 New implementation is the same as the previous one for ${target.contract} at ${targetAddress}. Skipping...`
        );
        continue;
      }

      console.log(
        `✅ New implementation deployed at: ${newImplementationAddress}`
      );

      const proxyAdmin = new ethers.Contract(proxyAdminAddress, [
        "function upgrade(address proxy, address implementation)",
        "function owner() view returns (address)",
      ]);
      const data = proxyAdmin.interface.encodeFunctionData("upgrade", [
        targetAddress,
        newImplementationAddress,
      ]);

      safeTx = {
        to: proxyAdminAddress!,
        value: "0",
        data,
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
          implementation: newImplementationAddress,
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
      newImplementationAddress = await resolveImplementationAddress(
        newImplementation
      );

      if (
        ethers.getAddress(previousImplementation) === newImplementationAddress
      ) {
        console.log(
          `🔄 New implementation is the same as the previous one for ${target.contract} at ${targetAddress}. Skipping...`
        );
        continue;
      }

      console.log(
        `✅ New implementation deployed at: ${newImplementationAddress}`
      );

      const data = beacon.interface.encodeFunctionData("upgradeTo", [
        newImplementationAddress,
      ]);

      safeTx = {
        to: targetAddress,
        value: "0",
        data,
        contractMethod: {
          name: "upgradeTo",
          payable: false,
          inputs: [{ name: "newImplementation", type: "address" }],
        },
        contractInputsValues: {
          newImplementation: newImplementationAddress,
        },
      };
    }

    if (shouldVerify) {
      try {
        console.log(
          `Verifying implementation for ${target.contract} on block explorer`
        );
        await run("verify:verify", {
          address: newImplementationAddress,
          constructorArguments: [],
        });
        console.log(`Verification successful for ${newImplementationAddress}`);
      } catch (error) {
        console.warn(
          `Verification skipped or failed for ${newImplementationAddress}:`,
          (error as Error).message ?? error
        );
      }
    }

    safeTransactions.push(safeTx);
  }

  console.log("----------------------------------------------------");
  if (safeTransactions.length === 0) {
    console.log("No upgrades were prepared. Exiting.");
    return;
  }

  const safeBatch = {
    version: "1.0",
    chainId: chainId.toString(),
    createdAt,
    meta: {
      name: `Ratio1 ${stage} upgrades`,
      description: "",
      txBuilderVersion: "1.0.0",
      createdFromSafeAddress: safeAddress,
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: safeTransactions,
  };

  const filePath = path.join(outputDir, `upgrade-${stage}-${Date.now()}.json`);
  writeFileSync(filePath, JSON.stringify(safeBatch, null, 2));
  console.log(`Upgrade data written to ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
