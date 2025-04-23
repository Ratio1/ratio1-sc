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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
