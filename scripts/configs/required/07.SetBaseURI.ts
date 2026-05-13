import { ethers } from "hardhat";
import { MND_BASE_URI, MND_SC_ADDR, ND_BASE_URI, ND_SC_ADDR } from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );
  const mndContract = await ethers.getContractAt(
    "MNDContract",
    MND_SC_ADDR,
    deployer
  );

  await ndContract.setBaseURI(ND_BASE_URI);
  console.log("ND base URI set");

  await mndContract.setBaseURI(MND_BASE_URI);
  console.log("MND base URI set");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
