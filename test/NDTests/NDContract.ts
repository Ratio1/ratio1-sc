import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;

describe("NDContract", function () {
	async function deploy() {
		const lockedAmount = BigNumber.from(50).mul(ONE_TOKEN);

		// Contracts are deployed using the first signer/account by default
		const [owner, secondSigner, third] = await ethers.getSigners();

		const TokeContract = await ethers.getContractFactory("NAEURA");
		const tokeContract = await TokeContract.deploy();

		const NDContract = await ethers.getContractFactory("NDContract");
		const ndContract = await NDContract.deploy(tokeContract.address, ONE_DAY_IN_SECS);

		tokeContract.setNdContract(ndContract.address);

		return { ndContract, tokeContract, owner, secondSigner };
	}

	it("buyLicense", async function () {
		const { ndContract, owner } = await deploy();
		let price = ndContract.getLicensePrice(1);
		expect(price).to.equal(ONE_TOKEN.mul(500));
	})

})