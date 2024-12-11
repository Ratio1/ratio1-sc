import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const GENESIS_SUPPLY = BigNumber.from(50).mul(ONE_TOKEN);
const newCycleDuration = 60;
const NAEURA_TOKEN_ADDR = "0xB082BFb77CF510cfC7902e3AeCaAa46fA2D0f52e";
const GENESIS_ADDR = "0x8270685220fAd7EDb232E649EeE9D8810dac1d58";
const UNISWAP_ROUTER_ADDR = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const APPROVE_AMOUNT = BigNumber.from(10).pow(18).mul(1000);

const MNDTokenAddress = '0x7a603Ff0A8657cEfdd23810695cc8BdB5999239c';
const NDTokenAddress = '0x9d531109B4Ae5Fe5bCCeecd341Cad501db15edf8';
const UNI_V2_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";


async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    console.log("Account balance:", (await deployer.getBalance()).toString());

    //   const Token = await ethers.getContractFactory("NAEURA");
    //   const NAEURAtoken = await Token.deploy();

    const factoryNAEURA = await ethers.getContractFactory("NAEURA");
    const NAEURAToken = factoryNAEURA.attach(NAEURA_TOKEN_ADDR);


    //   console.log("NAEURA Token address:", NAEURAtoken.address);

    //   const MNDToken = await ethers.getContractFactory("MNDContract");
    //   const mndToken = await MNDToken.deploy(NAEURAtoken.address);

    //   const NDToken = await ethers.getContractFactory("NDContract");
    //   const ndToken = await NDToken.deploy(NAEURAtoken.address, newCycleDuration);

    //   console.log("ND address:", ndToken.address);

    //   console.log("MND Token address:", mndToken.address);

    // await NAEURAToken.setMndContract(MNDTokenAddress);
    // await NAEURAToken.setNdContract(NDTokenAddress);

    // const NAEURAToken = await ethers.getContractFactory("NAEURA");
    // const NAEURAToken = NAEURAToken.attach(NAEURA_TOKEN_ADDR);
    // await NAEURAToken.approve(UNISWAP_ROUTER_ADDR, APPROVE_AMOUNT);

    await NAEURAToken.approve(UNISWAP_ROUTER_ADDR, APPROVE_AMOUNT);

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });