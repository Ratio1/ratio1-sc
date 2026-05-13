import { ethers } from "hardhat";
import { CONTROLLER_ADDR, ORACLE_ADDR } from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const controller = await ethers.getContractAt(
    "Controller",
    CONTROLLER_ADDR,
    deployer
  );

  await controller.removeOracle(ORACLE_ADDR);
  console.log("Oracle", ORACLE_ADDR, "removed from Controller");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
