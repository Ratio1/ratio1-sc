import { ethers } from "hardhat";
import { R1_TOKEN_ADDR } from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const TestnetFaucetContractFactory = await ethers.getContractFactory(
    "TestnetFaucet",
    deployer
  );
  const testnetFaucetContract = await TestnetFaucetContractFactory.deploy(
    "0x2d6a9cda5179399Ee6c44d78550696e68400F677",
    "1500000000", // 3000 tokens
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
