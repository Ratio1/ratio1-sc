import { ethers } from "hardhat";
import {
  ADOPTION_ORACLE_ADDR,
  ND_SC_ADDR,
  POAI_MANAGER_ADDR,
} from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );
  const poaiManager = await ethers.getContractAt(
    "PoAIManager",
    POAI_MANAGER_ADDR,
    deployer
  );

  await ndContract.setAdoptionOracle(ADOPTION_ORACLE_ADDR);
  console.log("ND adoptionOracle set");

  await poaiManager.setAdoptionOracle(ADOPTION_ORACLE_ADDR);
  console.log("PoAIManager adoptionOracle set");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
