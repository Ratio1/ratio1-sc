import { ethers } from "hardhat";
import { MND_SC_ADDR, ND_SC_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ReaderContractFactory = await ethers.getContractFactory(
    "Reader",
    deployer
  );
  const readerContract = await ReaderContractFactory.deploy(
    ND_SC_ADDR,
    MND_SC_ADDR
  );
  await readerContract.deployed();
  console.log("Reader deployed to:", readerContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
