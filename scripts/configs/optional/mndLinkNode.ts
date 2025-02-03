import { ethers } from "hardhat";
import { MND_SC_ADDR } from "../constants";

const LICENSE_ID = 0;
const NODE_ADDRESS_TO_LINK = "0x129a21A78EBBA79aE78B8f11d5B57102950c1Fc0";

async function main() {
  const [deployer] = await ethers.getSigners();

  const MNDContractFactory = await ethers.getContractFactory(
    "MNDContract",
    deployer
  );
  const ndContract = MNDContractFactory.attach(MND_SC_ADDR);

  await ndContract.linkNode(LICENSE_ID, NODE_ADDRESS_TO_LINK);
  console.log("Address", NODE_ADDRESS_TO_LINK, "linked to license", LICENSE_ID);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
