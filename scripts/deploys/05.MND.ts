import { ethers, upgrades } from "hardhat";
import {
  CONTROLLER_ADDR,
  R1_TOKEN_ADDR,
  SAFE_ADDR,
} from "../configs/constants";
import { sleep } from "../utils/sleep";

const PROXY_INDEXING_DELAY_MS = 5000;

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
  await mndContract.waitForDeployment();
  const proxyAddress = await mndContract.getAddress();
  console.log("MND deployed to:", proxyAddress);
  await sleep(PROXY_INDEXING_DELAY_MS);

  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("Implementation:", implAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(
    proxyAddress
  );
  console.log("Proxy Admin:", adminAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
