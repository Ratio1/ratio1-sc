import "@nomicfoundation/hardhat-toolbox";
import { ethers } from "hardhat";
import { MNDContract, NAEURA, NDContract } from "../typechain-types";
const BigNumber = ethers.BigNumber;

const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const CLIFF_PERIOD_IN_CYCLES = 120;
const TESTING_CLIFF_PERIOD_IN_CYCLES = 2;


const LP_ADDR = "0x85a336D59C954C864CF05b7EE6570AB76354F0FA";
const UNI_V2_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";

const USDC_ADDRESS = "0x6f14C02Fc1F78322cFd7d707aB90f18baD3B54f5";
const USDT_ADDRESS = "0xC3121820dEB161CFBe30e3855790fDcd1084d3f6";

const AMOUNT_1000 = BigNumber.from(10).pow(18).mul(10000);

const NAEURATokenAddress = '0x0E38d1AaC10A1e2E010bB5A919Cf6abFa76dA3E3';
const NDTokenAddress = '0xe60b4Ddca3D2F80966E4DB9e8Fd74CcAb5182AC3';
const MNDTokenAddress = '0xa7388FB0225DBF8701Be9a55F72961153d80C035';

const COSTIN_TEAM_MEMBER_ADDR = "0x18C50b2D22dDd8e4f6B52355Ebf5918Ea5Cf47b5";
const COSMIN_TEAM_MEMBER_ADDR = "0xb7ae1e56fdf24fc61323df875d0042d173def556";
const SORIN_TEAM_MEMBER = "0xBDf3fBCCbd4612aB56C770e1aD6EB982040e7254";
const GENESIS_ADDR = "0x8270685220fAd7EDb232E649EeE9D8810dac1d58"

const GENESIS_NODE_HASH = "NAEURA_genesis_node";


async function main() {
	const [owner] = await ethers.getSigners();
	console.log("Interacting with contracts with the account:", owner.address);

	// Init NAEURAL Contract
	const naeuralToken = await initNaeuralToken();
	// const ndContract = await initNDContract(naeuralToken)
	const mndContract = await initMNDContract(naeuralToken)

	// await setupND(ndContract);

	// Generate Genesis MND
	// await createGenesisMND(mndContract);

	// Generate MND for team members
	// await addLicense(mndContract, COSMIN_TEAM_MEMBER_ADDR, 50);
	// await addLicense(mndContract, COSTIN_TEAM_MEMBER_ADDR, 50);
	// await addLicense(mndContract, SORIN_TEAM_MEMBER, 50);
	// await addLicense(mndContract, COSMIN_TEAM_MEMBER_ADDR, 1);
	// await addLicense(mndContract, COSTIN_TEAM_MEMBER_ADDR, 1);
	// await addLicense(mndContract, SORIN_TEAM_MEMBER, 1);

	// Claim Genesis rewards
	await claimGenesisRewards(mndContract);

	// Get NAEURAL token balance for owner
	// const ownerBalance = await naeuralToken.balanceOf(owner.address);
	// console.log("NAEURA Balance of owner:", ownerBalance);

	// Estimate rewards
	// const nodeAvailability = [{ epoch: 115, availability: 255 }]
	// const rewards = await ndContract.estimateRewards(GENESIS_ADDR, 0, nodeAvailability)
	// console.log("Rewarsd:", rewards)

	//Get NAEURAL balance
	// let balance = await naeuralToken.balanceOf(owner.address)
	// console.log("Balance:", balance)

	// Get NAEURAL price
	// let price = await ndContract.getTokenPrice({ gasLimit: 100000 });
	// console.log("price:", price)

	// await approveTokens(naeuralToken, ndContract);
	// await ndContract.buyLicense(1, { gasLimit: 500000 })

	// // Get NAEURAL price
	// let price_after = await ndContract.getTokenPrice({ gasLimit: 100000 });
	// console.log("price:", price_after)

}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});


async function initNaeuralToken() {
	const factoryNAEURA = await ethers.getContractFactory("NAEURA");
	const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);
	console.log("NAEURA token address:", NAEURAToken.address);

	return NAEURAToken
}

async function initNDContract(naeuralToken: NAEURA) {
	const NDToken = await ethers.getContractFactory("NDContract");
	const ndContract = await NDToken.deploy(naeuralToken.address, GENESIS_ADDR, ONE_DAY_IN_SECS);
	// const ndContract = NDToken.attach(NDTokenAddress);
	console.log("NDContract address:", ndContract.address);
	await naeuralToken.setNdContract(ndContract.address);

	return ndContract
}

async function initMNDContract(naeuralToken: NAEURA) {
	const MNDToken = await ethers.getContractFactory("MNDContract");
	// const mndContract = await MNDToken.deploy(naeuralToken.address, GENESIS_ADDR, ONE_DAY_IN_SECS, TESTING_CLIFF_PERIOD_IN_CYCLES);
	const mndContract = MNDToken.attach(MNDTokenAddress);
	console.log("MNDContract address:", mndContract.address);
	// await naeuralToken.setMndContract(mndContract.address);

	return mndContract
}

async function setupND(ndContract: NDContract) {
	await ndContract.setUniswapPair(LP_ADDR);
	await ndContract.setUniswapRouter(UNI_V2_ROUTER_ADDRESS);
	await ndContract.set_usdcAddress(USDT_ADDRESS);
	console.log("NDContract setup completed");

}

async function createGenesisMND(mndContract: MNDContract) {
	// Register MND contract
	await mndContract.registerGenesisNode(GENESIS_NODE_HASH);
	console.log("Genesis Node Registered");

}

async function addLicense(mndContract: MNDContract, addr: string, power: number) {

	// Add Generic MND for Master
	await mndContract.addLicense(addr, power);
	console.log("Added license for:", addr, " with power:", power);

}
async function claimGenesisRewards(mndContract: MNDContract) {

	// Add Generic MND for Master
	await mndContract.claimGenesisRewards()
	console.log("Genesis Rewards claimed");

}



async function approveTokens(naeuralToken: any, ndContract: NDContract) {
	await naeuralToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 100000 })
	await naeuralToken.approve(ndContract.address, AMOUNT_1000, { gasLimit: 100000 })
}	