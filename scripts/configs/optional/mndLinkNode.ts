import { ethers } from "hardhat";
import { MND_SC_ADDR } from "../constants";

const LICENSE_ID = 0;
const NODE_ADDRESS_TO_LINK = "0x129a21A78EBBA79aE78B8f11d5B57102950c1Fc0";
const SIGNATURE = "0x";

async function main() {
  const [deployer] = await ethers.getSigners();

  const mndContract = await ethers.getContractAt(
    "MNDContract",
    MND_SC_ADDR,
    deployer
  );

  await mndContract.linkNode(LICENSE_ID, NODE_ADDRESS_TO_LINK, SIGNATURE);
  console.log("Address", NODE_ADDRESS_TO_LINK, "linked to license", LICENSE_ID);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
