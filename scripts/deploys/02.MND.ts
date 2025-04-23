import { ethers, upgrades } from "hardhat";
import {
  CONTROLLER_ADDR,
  R1_TOKEN_ADDR,
  SAFE_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const MNDContractFactory = await ethers.getContractFactory(
    "MNDContract",
    deployer
  );
  const mndContract = await upgrades.deployProxy(
    MNDContractFactory,
    [R1_TOKEN_ADDR, CONTROLLER_ADDR, SAFE_ADDR],
    { initializer: "initialize" }
  );
  await mndContract.deployed();
  console.log("MND deployed to:", mndContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
