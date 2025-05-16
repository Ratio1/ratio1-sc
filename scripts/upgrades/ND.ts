import { ethers, upgrades } from "hardhat";

const proxyAddress = "0x3026e13534f0E9A49520445761F42577989F3D31";

async function main() {
  const NewNDContract = await ethers.getContractFactory("NDContract");

  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Previous implementation:", prevImpl);

  const upgraded = await upgrades.upgradeProxy(proxyAddress, NewNDContract);

  const newImpl = await upgrades.erc1967.getImplementationAddress(
    upgraded.address
  );
  console.log("🔧 New implementation:", newImpl);
  const impl = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log("Current implementation:", impl);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
