import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const WithdrawerContractFactory = await ethers.getContractFactory(
    "RefundForwarder",
    deployer
  );
  const withdrawerContract = await WithdrawerContractFactory.deploy();
  await withdrawerContract.deployed();
  console.log("Withdrawer deployed to:", withdrawerContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
