import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const GENESIS_SUPPLY = BigNumber.from(50).mul(ONE_TOKEN);
const NAEURATokenAddress = '0xB082BFb77CF510cfC7902e3AeCaAa46fA2D0f52e';
const NDTokenAddress = "0x1a40D28a39f65cd8cCb8F5089DF1b729184A83b9";
const ONE_DAY_IN_SECS = 24 * 60 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const NDToken = await ethers.getContractFactory("NDContract");
  const ndContract = await NDToken.deploy(NAEURATokenAddress, ONE_DAY_IN_SECS);
  // const ndContract = NDToken.attach(NDTokenAddress);


  const factoryNAEURA = await ethers.getContractFactory("NAEURA");
  const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);

  await NAEURAToken.setNdContract(ndContract.address);

  console.log("ND address:", ndContract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });