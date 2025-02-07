import { ethers } from "hardhat";
import {
  R1_TOKEN_ADDR,
} from "../configs/constants";

async function main() {
  const [deployer] = await ethers.getSigners();

  const TestnetFaucetContractFactory =
    await ethers.getContractFactory("TestnetFaucet", deployer);
  const testnetFaucetContract =
    await TestnetFaucetContractFactory.deploy(
        "0xCA32aD806BB1e086D77c733656c20334bf2976D6",
        "3000000000000000000000", // 3000 tokens
        60 * 60 * 24 // 1 day
    );
  await testnetFaucetContract.deployed();
  console.log(
    "Testnet Faucet deployed to:",
    testnetFaucetContract.address
  );

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
