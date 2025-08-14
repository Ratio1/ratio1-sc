import { ethers, upgrades } from "hardhat";

const proxyAddress = "0xa8d7FFCE91a888872A9f5431B4Dd6c0c135055c1";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", await deployer.getAddress());

  const NewPoAIManager = await ethers.getContractFactory(
    "PoAIManager",
    deployer
  );

  // Get current implementation
  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Previous implementation:", prevImpl);

  // Validate the new implementation
  console.log("Validating new implementation...");
  try {
    await upgrades.validateImplementation(NewPoAIManager);
    console.log("✅ New implementation is safe to upgrade");
  } catch (error) {
    console.error("❌ Implementation validation failed:", error);
    throw error;
  }

  // Prepare the upgrade
  console.log("Preparing upgrade...");
  const upgradeTx = await upgrades.prepareUpgrade(proxyAddress, NewPoAIManager);
  console.log("🔧 New implementation address:", upgradeTx);

  // Get ProxyAdmin
  const admin = await upgrades.admin.getInstance();
  const proxyAdminAddress = admin.address;
  console.log("ProxyAdmin address:", proxyAdminAddress);

  console.log("\n========== Gnosis Safe Transaction ==========");
  console.log("To:", proxyAdminAddress);
  console.log("Function: upgrade(address proxy, address implementation)");
  console.log("Arguments:");
  console.log("  - Proxy Address:", proxyAddress);
  console.log("  - Implementation Address:", upgradeTx);
  console.log("Value: 0");
  console.log("Operation: 0 (CALL)");
  console.log("=============================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
