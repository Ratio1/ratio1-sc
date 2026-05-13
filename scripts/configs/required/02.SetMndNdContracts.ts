import { ethers } from "hardhat";
import { CONTROLLER_ADDR, MND_SC_ADDR, ND_SC_ADDR } from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const controller = await ethers.getContractAt(
    "Controller",
    CONTROLLER_ADDR,
    deployer
  );

  await controller.setContracts(ND_SC_ADDR, MND_SC_ADDR);
  console.log("ND and MND contracts set in Controller");

  const mndContract = await ethers.getContractAt(
    "MNDContract",
    MND_SC_ADDR,
    deployer
  );

  await mndContract.setNDContract(ND_SC_ADDR);
  console.log("ND contract address set in MND contract");

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );

  await ndContract.setMNDContract(MND_SC_ADDR);
  console.log("MND contract address set in ND contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
