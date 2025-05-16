import { ethers, upgrades } from "hardhat";

const proxyAddress = "0x911A520bB6a5F332377D6f24448d8B761Bc1d990";

async function main() {
  const NewMNDContract = await ethers.getContractFactory("MNDContract");

  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Previous implementation:", prevImpl);

  const upgraded = await upgrades.upgradeProxy(proxyAddress, NewMNDContract);

  const newImpl = await upgrades.erc1967.getImplementationAddress(
    upgraded.address
  );
  console.log("New implementation:", newImpl);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
