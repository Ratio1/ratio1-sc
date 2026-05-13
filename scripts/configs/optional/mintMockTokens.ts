import { ethers } from "hardhat";
import { USDC_TOKEN_ADDR } from "../constants";

const TOKENS_RECEIVER = "0x07F460c8C41cBf309422BFBC6EfDBBd6f4415298";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ERC20MockContract = await ethers.getContractAt(
    "ERC20Mock",
    USDC_TOKEN_ADDR,
    deployer
  );

  await ERC20MockContract.mint(TOKENS_RECEIVER, "500000000000"); // 500k tokens
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
