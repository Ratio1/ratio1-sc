import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const newCycleDuration = 60;
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const CLIFF_PERIOD_IN_CYCLES = 120;

const MNDTokenAddress = '0xe48A544aAFa03bFe9a96851E6c0fC0ef86B3eF55';
const NDTokenAddress = '0xe60b4Ddca3D2F80966E4DB9e8Fd74CcAb5182AC3';

const GENESIS_NODE_HASH = "NAEURA_genesis_node";


async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const Token = await ethers.getContractFactory("NAEURA");
  const NAEURAtoken = await Token.deploy();

  console.log("NAEURA Token address:", NAEURAtoken.address);

  // const factoryMND = await ethers.getContractFactory("MNDContract");
  // const mndContract = await factoryMND.deploy(NAEURAtoken.address, ONE_DAY_IN_SECS, CLIFF_PERIOD_IN_CYCLES);
  // console.log("MND Token address:", mndContract.address);

  // const factoryND = await ethers.getContractFactory("NDContract");
  // const ndContract = await factoryND.deploy(NAEURAtoken.address, newCycleDuration);
  // console.log("ND address:", ndContract.address);

  const NDToken = await ethers.getContractFactory("NDContract");
  const ndContract = NDToken.attach(NDTokenAddress);
  console.log("NDContract address:", ndContract.address);


  const MNDToken = await ethers.getContractFactory("MNDContract");
  const mndContract = MNDToken.attach(MNDTokenAddress);
  console.log("MNDContract address:", mndContract.address);


  // assign MND and ND to NAEURA token 
  await NAEURAtoken.setMndContract(mndContract.address);
  await NAEURAtoken.setNdContract(ndContract.address);

  // // Register MND contract
  // await mndContract.registerGenesisNode(GENESIS_NODE_HASH);


}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });