import { ethers } from "hardhat";
import { SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const R1ContractFactory = await ethers.getContractFactory("R1", deployer);
  const r1Contract = await R1ContractFactory.deploy(SAFE_ADDR);
  await r1Contract.deployed();
  console.log("R1 deployed to:", r1Contract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
