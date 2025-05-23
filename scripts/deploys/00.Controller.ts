import { ethers } from "hardhat";
import { SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ControllerContractFactory = await ethers.getContractFactory(
    "Controller",
    deployer
  );
  const controllerContract = await ControllerContractFactory.deploy(
    1747310400,
    3600,
    SAFE_ADDR
  );
  await controllerContract.deployed();
  console.log("Controller deployed to:", controllerContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
