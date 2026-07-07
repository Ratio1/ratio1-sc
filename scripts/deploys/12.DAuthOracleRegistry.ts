import { ethers } from "hardhat";
import { CONTROLLER_ADDR, SAFE_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const DAuthOracleRegistryContractFactory = await ethers.getContractFactory(
    "DAuthOracleRegistry",
    deployer
  );
  const dAuthOracleRegistry =
    await DAuthOracleRegistryContractFactory.deploy(CONTROLLER_ADDR, SAFE_ADDR);
  await dAuthOracleRegistry.waitForDeployment();

  const dAuthOracleRegistryAddress = await dAuthOracleRegistry.getAddress();
  console.log("DAuthOracleRegistry deployed to:", dAuthOracleRegistryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
