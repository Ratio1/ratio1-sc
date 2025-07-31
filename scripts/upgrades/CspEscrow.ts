import { ethers, upgrades } from "hardhat";
import { CSP_ESCROW_BEACON_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", await deployer.getAddress());

  const NewCspEscrow = await ethers.getContractFactory("CspEscrow", deployer);

  // Get current implementation from beacon
  const beacon = await ethers.getContractAt(
    "UpgradeableBeacon",
    CSP_ESCROW_BEACON_ADDR
  );
  const prevImpl = await beacon.implementation();
  console.log("Previous implementation:", prevImpl);

  // Validate the new implementation
  console.log("Validating new implementation...");
  try {
    await upgrades.validateImplementation(NewCspEscrow);
    console.log("✅ New implementation is safe to upgrade");
  } catch (error) {
    console.error("❌ Implementation validation failed:", error);
    throw error;
  }

  // Deploy new implementation
  console.log("Deploying new implementation...");
  const newImplementation = await NewCspEscrow.deploy();
  await newImplementation.deployed();
  console.log("🔧 New implementation deployed to:", newImplementation.address);

  console.log("\n========== Gnosis Safe Transaction ==========");
  console.log("To:", CSP_ESCROW_BEACON_ADDR);
  console.log("Function: upgradeTo(address implementation)");
  console.log("Arguments:");
  console.log("  - Implementation Address:", newImplementation.address);
  console.log("Value: 0");
  console.log("Operation: 0 (CALL)");
  console.log("=============================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
