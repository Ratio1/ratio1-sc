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
  await adoptionOracle.waitForDeployment();
  const proxyAddress = await adoptionOracle.getAddress();
  console.log("AdoptionOracle deployed to:", proxyAddress);
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
