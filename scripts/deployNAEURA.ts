import { ethers } from "hardhat";

const NAEURATokenAddress = '0xeA360b8766560353AE43d29B5042CA0Df263627c';

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const factoryNAEURA = await ethers.getContractFactory("NAEURA");
  const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);


  console.log("Token address:", NAEURAToken.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });