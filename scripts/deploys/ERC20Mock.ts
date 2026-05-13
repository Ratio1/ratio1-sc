import { ethers } from "hardhat";

const TOKENS_RECEIVER = "0x28227b7CC798A98155162037Fec822AA138ac0EB";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ERC20MockFactory = await ethers.getContractFactory(
    "ERC20Mock",
    deployer
  );
  const ERC20MockContract = await ERC20MockFactory.deploy();
  await ERC20MockContract.waitForDeployment();
  const tokenAddress = await ERC20MockContract.getAddress();
  console.log("ERC20Mock deployed to:", tokenAddress);

  await ERC20MockContract.mint(TOKENS_RECEIVER, "500000000000"); // 500k tokens
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
