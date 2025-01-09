/*import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const POWER_1 = 1;
const POWER_5 = 5;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;

const CLIFF_PERIOD_IN_CYCLES = 120;


const ONE_YEAR_IN_SECS = 365 * ONE_DAY_IN_SECS;

const MAX_PERCENT = 10000;
const PRICE_DECIMALS = BigNumber.from(10).pow(18)
const MAX_TOKEN_SUPPLY = BigNumber.from(1618033988).mul(PRICE_DECIMALS);
const GENESIS_TOTAL_EMISSION = MAX_TOKEN_SUPPLY.mul(3320).div(MAX_PERCENT)

const TOTAL_EMISSION_PER_MASTER_LICENSE =
	MAX_TOKEN_SUPPLY.mul(PRICE_DECIMALS).div(MAX_PERCENT); // 0.01% of total supply

const GENESIS_NODE_HASH = "NAEURA_genesis_node";
const SECOND_USER_NODE_HASH = "second_user_node";

const MAINNET_TIMESTAMP = 1726862400; // 2024-09-20 20:00:00 UTC

interface NodeAvailability {
	epoch: number;
	availability: number;
}

interface ComputeRewardsParams {
	masterLicenseId: number;
	nodeHash: string;
	nodeAvailabilities: NodeAvailability[];
}

interface ComputeRewardsResult {
	masterLicenseId: number;
	rewardsAmount: number;
}


describe("MNDContract - genesisInteraction module", function () {
	async function deploy() {
		// Contracts are deployed using the first signer/account by default
		const [owner, secondSigner, third] = await ethers.getSigners();

		const TokeContract = await ethers.getContractFactory("NAEURA");
		const tokeContract = await TokeContract.deploy();

		const MNDContract = await ethers.getContractFactory("MNDContract");
		const mndContract = await MNDContract.deploy(tokeContract.address, owner.address, ONE_DAY_IN_SECS, CLIFF_PERIOD_IN_CYCLES);

		mndContract.registerGenesisNode(GENESIS_NODE_HASH);
		tokeContract.setMndContract(mndContract.address);

		return { mndContract, tokeContract, owner, secondSigner };
	}

	it('should create genesis MND', async function () {
		const { mndContract, owner } = await deploy();
		await time.setNextBlockTimestamp(MAINNET_TIMESTAMP);

		const genesisMND = await mndContract.genesisNode(owner.address);

		expect(genesisMND[0] == GENESIS_NODE_HASH)

		mndContract.hasLicense(owner.address, GENESIS_NODE_HASH);
	});

	it('genesis lastClaimTimestamp should increase lastClaim after claim', async function () {
		const { mndContract, tokeContract, owner, secondSigner } = await deploy();
		// await time.setNextBlockTimestamp(MAINNET_TIMESTAMP);

		const newTime = await time.increase(100000);

		const tx = await mndContract.claimGenesisRewards();
		const genesisMND = await mndContract.genesisNode(owner.address);
		expect(genesisMND.lastClaimTimestamp).to.approximately(newTime, 10);
	});

	it('owner should be able to add mnd to another user', async function () {
		const { mndContract, tokeContract, owner, secondSigner } = await deploy();
		await mndContract.addLicense(secondSigner.address, POWER_1);

		const power = 10;

		const addedMnd = await mndContract.addLicense(secondSigner.address, power);

		const hasLicense = await mndContract.hasLicense(secondSigner.address, 1);
		expect(hasLicense).to.eq(true);
		// expect(addedMnd.exists).to.eq(true);
		// expect(addedMnd.masterLicenseId).to.eq(current_nonce);
		// expect(addedMnd.licensePower).to.eq(1);

	});

	it('should not go over the value limit', async function () {
		const { mndContract, tokeContract, owner, secondSigner } = await deploy();
		const mnd = await mndContract.genesisNode(owner.address);

		await time.increase(ONE_YEAR_IN_SECS);
		await mndContract.claimGenesisRewards();

		let balance = await tokeContract.balanceOf(owner.address);
		let balanceMND = await tokeContract.balanceOf(mndContract.address);

		let expectedBalance = GENESIS_TOTAL_EMISSION
		expect(balance).to.eq(expectedBalance);

		await expect(mndContract.claimGenesisRewards()).to.be.revertedWith("All rewards have been claimed");
	});
})*/