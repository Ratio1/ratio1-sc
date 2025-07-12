import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const WithdrawerContractFactory = await ethers.getContractFactory(
    "RefundForwarder",
    deployer
  );
  const withdrawerContract = WithdrawerContractFactory.attach(
    "0x6444C6c2D527D85EA97032da9A7504d6d1448ecF"
  );

  await withdrawerContract.withdrawETH();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
