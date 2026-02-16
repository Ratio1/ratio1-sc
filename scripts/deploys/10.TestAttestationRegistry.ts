import { ethers, upgrades } from "hardhat";
import { POAI_MANAGER_ADDR, SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying TestAttestationRegistry...");
  const factory = await ethers.getContractFactory("TestAttestationRegistry", deployer);
  const registry = await upgrades.deployProxy(
    factory,
    [
      SAFE_ADDR, // newOwner
      POAI_MANAGER_ADDR, // poaiManager
      false, // nodeWhitelistEnforced
    ],
    { initializer: "initialize" }
  );
  await registry.waitForDeployment();

  const proxyAddress = await registry.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log("TestAttestationRegistry deployed to:", proxyAddress);
  console.log("TestAttestationRegistry Implementation:", implAddress);
  console.log("TestAttestationRegistry Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
