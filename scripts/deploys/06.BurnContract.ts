import { ethers } from "hardhat";
import { R1_TOKEN_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying BurnContract...");
  console.log("Deployer address:", await deployer.getAddress());

  const BurnContractFactory = await ethers.getContractFactory(
    "BurnContract",
    deployer
  );
  const burnContract = await BurnContractFactory.deploy(R1_TOKEN_ADDR);
  await burnContract.waitForDeployment();

  console.log("BurnContract deployed to:", await burnContract.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
