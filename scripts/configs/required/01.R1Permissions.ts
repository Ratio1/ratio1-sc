import { ethers } from "hardhat";
import {
  BURN_CONTRACT_ADDR,
  MND_SC_ADDR,
  ND_SC_ADDR,
  R1_TOKEN_ADDR,
} from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const r1 = await ethers.getContractAt("R1", R1_TOKEN_ADDR, deployer);

  await r1.setMndContract(MND_SC_ADDR);
  console.log("MND contract set in R1");

  await r1.setNdContract(ND_SC_ADDR);
  console.log("ND contract set in R1");

  await r1.addBurner(BURN_CONTRACT_ADDR);
  console.log("BurnContract added as R1 burner");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
