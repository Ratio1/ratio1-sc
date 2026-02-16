import { ethers, upgrades } from "hardhat";
import { POAI_MANAGER_ADDR, SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying AttestationRegistry...");
  const factory = await ethers.getContractFactory("AttestationRegistry", deployer);
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

  console.log("AttestationRegistry deployed to:", proxyAddress);
  console.log("AttestationRegistry Implementation:", implAddress);
  console.log("AttestationRegistry Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
