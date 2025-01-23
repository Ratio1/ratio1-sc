import { ethers } from "hardhat";

const TOKENS_RECEIVER = "";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ERC20MockFactory = await ethers.getContractFactory(
    "ERC20Mock",
    deployer
  );
  const ERC20MockContract = await ERC20MockFactory.deploy();
  await ERC20MockContract.deployed();
  console.log("ERC20Mock deployed to:", ERC20MockContract.address);

  await ERC20MockContract.mint(TOKENS_RECEIVER, "1000000000000000000000");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
