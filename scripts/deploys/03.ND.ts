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

  await ndContract.deployed();
  console.log("ND deployed to:", ndContract.address);
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    ndContract.address
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    ndContract.address
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
