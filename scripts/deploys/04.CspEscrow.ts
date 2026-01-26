import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying CspEscrow implementation...");
  console.log("Deployer address:", await deployer.getAddress());

  const CspEscrowFactory = await ethers.getContractFactory(
    "CspEscrow",
    deployer
  );

  // Deploy the implementation contract
  const cspEscrowImplementation = await CspEscrowFactory.deploy();
  await cspEscrowImplementation.waitForDeployment();
  const implementationAddress = await cspEscrowImplementation.getAddress();
  console.log(
    "CspEscrow implementation deployed to:",
    implementationAddress
  );

  // Verify the implementation is safe to upgrade
  try {
    await upgrades.validateImplementation(CspEscrowFactory);
  } catch (error) {
    console.error("❌ Implementation validation failed:", error);
    throw error;
  }

  console.log("\n=== DEPLOYMENT SUMMARY ===");
  console.log("CspEscrow Implementation:", implementationAddress);
  console.log("==========================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
