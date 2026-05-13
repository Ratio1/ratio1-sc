import { ethers, upgrades } from "hardhat";
import { BURN_CONTRACT_ADDR, R1_TOKEN_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying GratitudeBurn...");
  console.log("Deployer address:", await deployer.getAddress());

  const GratitudeBurnFactory = await ethers.getContractFactory(
    "GratitudeBurn",
    deployer
  );
  const gratitudeBurn = await upgrades.deployProxy(
    GratitudeBurnFactory,
    [R1_TOKEN_ADDR, BURN_CONTRACT_ADDR],
    { initializer: "initialize" }
  );

  await gratitudeBurn.waitForDeployment();
  const proxyAddress = await gratitudeBurn.getAddress();
  console.log("GratitudeBurn deployed to:", proxyAddress);

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
