import { ethers } from "hardhat";
import { R1_TOKEN_ADDR, SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const NDContractFactory = await ethers.getContractFactory(
    "NDContract",
    deployer
  );
  const ndContract = await NDContractFactory.deploy(R1_TOKEN_ADDR, SAFE_ADDR);
  await ndContract.deployed();
  console.log("ND deployed to:", ndContract.address);
  /*
  const R1ContractFactory = await ethers.getContractFactory("R1", deployer);
  const r1Contract = R1ContractFactory.attach(R1_TOKEN_ADDR);
  await r1Contract.setNdContract(ndContract.address);
  console.log("ND contract address set in R1 contract");
  */
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
