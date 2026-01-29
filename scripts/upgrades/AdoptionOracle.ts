import { ethers, upgrades } from "hardhat";
import { ADOPTION_ORACLE_ADDR } from "../configs/constants";

async function main() {
  const NewAdoptionOracle = await ethers.getContractFactory("AdoptionOracle");

  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    ADOPTION_ORACLE_ADDR
  );
  console.log("Previous implementation:", prevImpl);

  const upgradeTx = await upgrades.prepareUpgrade(
    ADOPTION_ORACLE_ADDR,
    NewAdoptionOracle
  );
  console.log("🔧 New implementation address:", upgradeTx);

  const admin = await upgrades.admin.getInstance();
  const proxyAdminAddress = admin.address;
  console.log("ProxyAdmin address:", proxyAdminAddress);

  console.log("========== Gnosis Safe Transaction ==========");
  console.log("To:", proxyAdminAddress);
  console.log("Function: upgrade(address proxy, address implementation)");
  console.log("Arguments:");
  console.log("  - Proxy Address:", ADOPTION_ORACLE_ADDR);
  console.log("  - Implementation Address:", upgradeTx);
  console.log("Value: 0");
  console.log("Operation: 0 (CALL)");
  console.log("=============================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
