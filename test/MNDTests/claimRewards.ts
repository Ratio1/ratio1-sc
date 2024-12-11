import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const POWER_1 = 1;
const POWER_5 = 5;
const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;

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


describe("MNDContract - claimRewards module", function () {
	async function deploy() {
		// Contracts are deployed using the first signer/account by default
		const [owner, secondSigner, third] = await ethers.getSigners();

		const TokeContract = await ethers.getContractFactory("NAEURA");
		const tokeContract = await TokeContract.deploy();

		const MNDContract = await ethers.getContractFactory("MNDContract");
		const mndContract = await MNDContract.deploy(tokeContract.address, ONE_DAY_IN_SECS);

		mndContract.registerGenesisNode(GENESIS_NODE_HASH);
		tokeContract.setMndContract(mndContract.address);

		return { mndContract, tokeContract, owner, secondSigner };
	}

	it('call claimRewards is 0 for the first 4 months', async function () {
		const { mndContract, tokeContract, owner, secondSigner } = await deploy();
		await time.setNextBlockTimestamp(MAINNET_TIMESTAMP);

		await mndContract.addLicense(secondSigner.address, POWER_1);
		expect(await mndContract.hasLicense(secondSigner.address, 0)).to.eq(true);

		await mndContract.connect(secondSigner).registerNode(0, SECOND_USER_NODE_HASH);

		let myComputeRewardsParams = <ComputeRewardsParams>{};
		myComputeRewardsParams.masterLicenseId = 0;
		myComputeRewardsParams.nodeHash = SECOND_USER_NODE_HASH;
		myComputeRewardsParams.nodeAvailabilities = [];
		for (let i = 0; i < 100; i++) {
			myComputeRewardsParams.nodeAvailabilities.push({ epoch: i, availability: 255 });
		}

		const estimatedRewards = await mndContract.estimateRewards(secondSigner.address, [myComputeRewardsParams]);
		expect(estimatedRewards[0].masterLicenseId).to.eq(0);
		expect(estimatedRewards[0].rewardsAmount).to.eq(0);

		console.log("Time:", await time.latest());
		await time.setNextBlockTimestamp(MAINNET_TIMESTAMP + 100 * ONE_DAY_IN_SECS);

		const estimatedRewards2 = await mndContract.estimateRewards(secondSigner.address, [myComputeRewardsParams]);
		expect(estimatedRewards2[0].masterLicenseId).to.eq(0);
		expect(estimatedRewards2[0].rewardsAmount).to.eq(0); // this is okay cause of the cliff
	});

	it('call claimRewards for the first year should include the first 4 months', async function () {
		const { mndContract, tokeContract, owner, secondSigner } = await deploy();

		await mndContract.addLicense(secondSigner.address, POWER_1);
		let time1 = await time.latest();
		console.log("Time1:", time1);

		expect(await mndContract.hasLicense(secondSigner.address, 0)).to.eq(true);

		await mndContract.connect(secondSigner).registerNode(0, SECOND_USER_NODE_HASH);

		let myComputeRewardsParams = <ComputeRewardsParams>{};
		myComputeRewardsParams.masterLicenseId = 0;
		myComputeRewardsParams.nodeHash = SECOND_USER_NODE_HASH;
		myComputeRewardsParams.nodeAvailabilities = [];
		for (let i = 0; i < 365; i++) {
			myComputeRewardsParams.nodeAvailabilities.push({ epoch: i, availability: 255 });
		}

		await time.increase(365 * ONE_DAY_IN_SECS - 1);
		let time2 = await time.latest();
		console.log("Time1:", time2);
		console.log("Time diff:", time2 - time1);

		const estimatedRewards = await mndContract.estimateRewards(secondSigner.address, [myComputeRewardsParams]);
		expect(estimatedRewards[0].masterLicenseId).to.eq(0);
		expect(estimatedRewards[0].rewardsAmount).to.eq(TOTAL_EMISSION_PER_MASTER_LICENSE.div(5));


	});

})