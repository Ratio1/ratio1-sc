import { ethers } from "hardhat";
import { MND_SC_ADDR, ND_SC_ADDR } from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const MNDContractFactory = await ethers.getContractFactory(
    "MNDContract",
    deployer
  );
  const mndContract = MNDContractFactory.attach(MND_SC_ADDR);

  await mndContract.setNDContract(ND_SC_ADDR);
  console.log("ND contract address set in MND contract");

  const NDContractFactory = await ethers.getContractFactory(
    "NDContract",
    deployer
  );
  const ndContract = NDContractFactory.attach(ND_SC_ADDR);

  await ndContract.setMNDContract(MND_SC_ADDR);
  console.log("MND contract address set in ND contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
