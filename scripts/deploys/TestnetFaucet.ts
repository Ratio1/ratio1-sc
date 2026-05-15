import { ethers } from "hardhat";
import { R1_TOKEN_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const TestnetFaucetContractFactory = await ethers.getContractFactory(
    "TestnetFaucet",
    deployer
  );
  const testnetFaucetContract = await TestnetFaucetContractFactory.deploy(
    R1_TOKEN_ADDR,
    ethers.parseEther("3000"),
    60 * 60 * 24 // 1 day
  );
  await testnetFaucetContract.waitForDeployment();
  const faucetAddress = await testnetFaucetContract.getAddress();
  console.log("Testnet Faucet deployed to:", faucetAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
