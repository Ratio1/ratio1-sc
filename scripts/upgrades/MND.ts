import { ethers, upgrades } from "hardhat";

const proxyAddress = "0x911A520bB6a5F332377D6f24448d8B761Bc1d990";

async function main() {
  const NewMNDContract = await ethers.getContractFactory("MNDContract");

  const prevImpl = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Previous implementation:", prevImpl);

  const upgradeTx = await upgrades.prepareUpgrade(proxyAddress, NewMNDContract);
  console.log("🔧 New implementation address:", upgradeTx);

  // Get ProxyAdmin
  const admin = await upgrades.admin.getInstance();
  const proxyAdminAddress = admin.address;
  console.log("ProxyAdmin address:", proxyAdminAddress);

  // Encode the upgrade call
  const proxyAdminIface = new ethers.utils.Interface([
    "function upgrade(address proxy, address implementation)",
  ]);
  const calldata = proxyAdminIface.encodeFunctionData("upgrade", [
    proxyAddress,
    upgradeTx,
  ]);

  console.log("========== Gnosis Safe Transaction ==========");
  console.log("To:", proxyAdminAddress);
  console.log("Data:", calldata);
  console.log("Value: 0");
  console.log("Operation: 0 (CALL)");
  console.log("=============================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
