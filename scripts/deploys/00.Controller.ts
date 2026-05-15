import { ethers } from "hardhat";
import {
  EPOCH_DURATION,
  SAFE_ADDR,
  START_EPOCH_TIMESTAMP,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ControllerContractFactory = await ethers.getContractFactory(
    "Controller",
    deployer
  );
  const controllerContract = await ControllerContractFactory.deploy(
    START_EPOCH_TIMESTAMP,
    EPOCH_DURATION,
    SAFE_ADDR
  );
  await controllerContract.waitForDeployment();
  const controllerAddress = await controllerContract.getAddress();
  console.log("Controller deployed to:", controllerAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
