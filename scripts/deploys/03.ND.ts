import { ethers, upgrades } from "hardhat";
import {
  R1_TOKEN_ADDR,
  CONTROLLER_ADDR,
  SAFE_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const NDContractFactory = await ethers.getContractFactory(
    "NDContract",
    deployer
  );

  const ndContract = await upgrades.deployProxy(
    NDContractFactory,
    [R1_TOKEN_ADDR, CONTROLLER_ADDR, SAFE_ADDR],
    { initializer: "initialize" }
  );

  await ndContract.waitForDeployment();
  const proxyAddress = await ndContract.getAddress();
  console.log("ND deployed to:", proxyAddress);
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    proxyAddress
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
