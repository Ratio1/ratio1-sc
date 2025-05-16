import { ethers, upgrades } from "hardhat";
import {
  CONTROLLER_ADDR,
  R1_TOKEN_ADDR,
  SAFE_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const MNDContractFactory = await ethers.getContractFactory(
    "MNDContract",
    deployer
  );
  const mndContract = await upgrades.deployProxy(
    MNDContractFactory,
    [R1_TOKEN_ADDR, CONTROLLER_ADDR, SAFE_ADDR],
    { initializer: "initialize" }
  );
  await mndContract.deployed();
  console.log("MND deployed to:", mndContract.address);
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    mndContract.address
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    mndContract.address
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
