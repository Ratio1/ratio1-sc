import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const GENESIS_ADDR = "0x8270685220fAd7EDb232E649EeE9D8810dac1d58";
const MASTER_ADDR = "0x18C50b2D22dDd8e4f6B52355Ebf5918Ea5Cf47b5";
const ALICE_ADDR = "0x182cE25e3A750A9c95E53127a35F6cc497F7A99f";
const TEAM_MEMBER_ADDR = "0xB7aE1E56FdF24fC61323Df875d0042D173Def556";

const THREE_YEARS_IN_SECS = 3 * 365 * 24 * 60 * 60;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const GENERIC_MND_SUPPLY = BigNumber.from(1).mul(ONE_TOKEN);

const GENESIS_NODE_HASH = "NAEURA_genesis_node";


async function main() {
	const MNDTokenAddress = '0x7a603Ff0A8657cEfdd23810695cc8BdB5999239c';
	const [owner] = await ethers.getSigners();

	console.log("Interacting with contracts with the account:", owner.address);

	const factoryMND = await ethers.getContractFactory("MNDContract");
	const mndContract = factoryMND.attach(MNDTokenAddress);

	console.log("MNDContract:", mndContract.address);


	// Register MND contract
	// await mndContract.registerGenesisNode(GENESIS_NODE_HASH);


	// Claim Rewards for Genesis
	// await mndContract.claimGenesisRewards();


	// const ownerBalance = await NAEURAToken.balanceOf(owner.address);
	// console.log("Balance before claim:", ownerBalance);

	// Genesis Node claims rewards
	// const tx = await mndToken.claim();
	// console.log("Balance after claim:", ownerBalance);


	// Print Genesis MND
	// const genesisMND = await mndToken.mnds(GENESIS_ADDR, 0);
	// console.log("GENESIS MND: ", genesisMND);

	// Add Generic MND for Master
	await mndContract.addLicense(TEAM_MEMBER_ADDR, 10);

	// Add Generic MND for Master
	// await mndToken.addMultipleMnds(MASTER_ADDR, THREE_YEARS_IN_SECS, 4);

	// // Print Generic MND for Master
	// const masterMND = await mndToken.mnds(ALICE_ADDR, 0);
	// console.log("MASTER MND: ", masterMND);

	//View: get number of mnds for Master
	// const viewMND = await mndToken.getNumberMnds(MASTER_ADDR);
	// console.log("View: number of MNDs for Master: ", viewMND);

	//View: get number of mnds for Master
	// const estimatedRewards = await mndToken.estimateRewards(MASTER_ADDR);
	// console.log("View: estimated rewards for Master: ", estimatedRewards);

	//View: get number of mnds for Master
	// const getMnds = await mndToken.getMnds(GENESIS_ADDR);
	// console.log("View: MNDs of Master: ", getMnds);

}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});