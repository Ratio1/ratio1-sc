import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const GENESIS_SUPPLY = BigNumber.from(50).mul(ONE_TOKEN);
const NAEURA_TOKEN_ADDR = "0xeA360b8766560353AE43d29B5042CA0Df263627c";
const ONE_DAY_IN_SECS = 24 * 60 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const MNDToken = await ethers.getContractFactory("MNDContract");
  const mndToken = await MNDToken.deploy(NAEURA_TOKEN_ADDR, ONE_DAY_IN_SECS);

  console.log("MND address:", mndToken.address);

  const NAEURAToken = await ethers.getContractFactory("NAEURA");
  const NAEURAToken = NAEURAToken.attach(NAEURA_TOKEN_ADDR);
  await NAEURAToken.setMndContract(mndToken.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });