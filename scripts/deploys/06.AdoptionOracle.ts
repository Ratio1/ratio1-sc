import { ethers, upgrades } from "hardhat";
import {
  SAFE_ADDR,
  ND_SC_ADDR,
  POAI_MANAGER_ADDR,
  ND_FULL_RELEASE_THRESHOLD,
  POAI_VOLUME_FULL_RELEASE_THRESHOLD,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying AdoptionOracle...");
  const AdoptionOracleFactory = await ethers.getContractFactory(
    "AdoptionOracle",
    deployer
  );
  const adoptionOracle = await upgrades.deployProxy(
    AdoptionOracleFactory,
    [
      SAFE_ADDR,
      ND_SC_ADDR,
      POAI_MANAGER_ADDR,
      ND_FULL_RELEASE_THRESHOLD,
      POAI_VOLUME_FULL_RELEASE_THRESHOLD,
    ],
    { initializer: "initialize" }
  );
  await adoptionOracle.deployed();
  console.log("AdoptionOracle deployed to:", adoptionOracle.address);

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

  await ndContract.setAdoptionOracle(adoptionOracle.address);
  await poaiManager.setAdoptionOracle(adoptionOracle.address);

  console.log("AdoptionOracle linked to ND and PoAIManager");

  const implAddress = await upgrades.erc1967.getImplementationAddress(
    adoptionOracle.address
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    adoptionOracle.address
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
