import { ethers, upgrades } from "hardhat";
import { ND_SC_ADDR } from "../configs/constants";

const proxyAddress = ND_SC_ADDR;

async function main() {
  const NewNDContract = await ethers.getContractFactory("NDContract");

  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Previous implementation:", prevImpl);

  const upgradeTx = await upgrades.prepareUpgrade(proxyAddress, NewNDContract);
  console.log("New implementation address:", upgradeTx);

  const proxyAdminAddress = await upgrades.erc1967.getAdminAddress(
    proxyAddress
  );
  console.log("ProxyAdmin address:", proxyAdminAddress);

  console.log("========== Gnosis Safe Transaction ==========");
  console.log("To:", proxyAdminAddress);
  console.log("Function: upgrade(address proxy, address implementation)");
  console.log("Arguments:");
  console.log("  - Proxy Address:", proxyAddress);
  console.log("  - Implementation Address:", upgradeTx);
  console.log("Value: 0");
  console.log("Operation: 0 (CALL)");
  console.log("=============================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
