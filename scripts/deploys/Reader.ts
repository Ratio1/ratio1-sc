import { ethers, upgrades } from "hardhat";
import { CONTROLLER_ADDR, MND_SC_ADDR, ND_SC_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ReaderContractFactory = await ethers.getContractFactory(
    "Reader",
    deployer
  );

  const readerContract = await upgrades.deployProxy(
    ReaderContractFactory,
    [ND_SC_ADDR, MND_SC_ADDR, CONTROLLER_ADDR],
    { initializer: "initialize" }
  );

  await readerContract.deployed();
  console.log("Reader deployed to:", readerContract.address);
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    readerContract.address
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    readerContract.address
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
