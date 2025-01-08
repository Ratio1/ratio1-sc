import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers,  } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { NAEURA, NDContract } from "../../typechain-types";
const BigNumber = ethers.BigNumber;

const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const USDC_ADDRESS = "0x6f14C02Fc1F78322cFd7d707aB90f18baD3B54f5";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const BACKEND_ADDRESS = "0xf2e3878c9ab6a377d331e252f6bf3673d8e87323";
const EXPECTED_SIGNATURE = "fa1bf2ef9a369508431ea63097a2588bd2f0b8ea2d8287f6ffe24d31bab0f1814c994d070640df82fea7cff562c80017c6f5342ec0de42b6cefde41d4a87d7261c"

describe("NDContract", function () {

	async function deploy() {
		const lockedAmount = BigNumber.from(50).mul(ONE_TOKEN);

		// Contracts are deployed using the first signer/account by default
		const [owner, secondSigner] = await ethers.getSigners();

		const NAEURAContract = await ethers.getContractFactory("NAEURA");
		const naeuraContract = await NAEURAContract.deploy();

		const NDContract = await ethers.getContractFactory("NDContract");
		const ndContract = await NDContract.deploy(naeuraContract.address, BACKEND_ADDRESS);

		const UniswapContract = await ethers.getContractFactory("UNISWAP");
		const uniswapContract = await UniswapContract.deploy();

		await ndContract.setUniswapRouter(uniswapContract.address)
		await ndContract.setUsdcAddress(USDC_ADDRESS)

		await naeuraContract.setNdContract(ndContract.address);
		await naeuraContract.setMndContract(owner.address);

		return { ndContract, naeuraContract, owner, secondSigner };
	}

	async function buyLicenseWithMintAndAllowance(naeuraContract:NAEURA, ndContract:NDContract, owner:SignerWithAddress, secondSigner:SignerWithAddress,numTokens:number, numLicenses:number,priceTier:number) {

		//TODO add signature from backend and check signers
		await naeuraContract.connect(owner).mint(secondSigner.address, ONE_TOKEN.mul(numTokens));
		await naeuraContract.connect(secondSigner).approve(ndContract.address, ONE_TOKEN.mul(numTokens));
		await ndContract.connect(secondSigner).buyLicense(numLicenses,priceTier);
	}

	async function linkNode( ndContract:NDContract, secondSigner:SignerWithAddress, licenseId: number ) {
		await ndContract.connect(secondSigner).linkNode(licenseId,NODE_ADDRESS);
	}

	async function unlinkNode( ndContract:NDContract, secondSigner:SignerWithAddress, licenseId: number ) {
		await ndContract.connect(secondSigner).unlinkNode(licenseId);
	}


	it("Buy license", async function () { 
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();
		console.log(secondSigner.address)

		//DO TEST
		let price = await ndContract.getLicensePriceInUSD();
		expect(price).to.equal(500);
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1);
		let result = await ndContract.ownerOf(1)
		expect(result).to.equal(secondSigner.address);
	})

	it("Bulk buy license- change tier", async function () {//TODO _priceTiers storage
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();

		//DO TEST - buy 89 licenses(all first tier)
		expect((await ndContract.currentPriceTier())).to.equal(1);
		for (let i = 1; i <= 17; i++) {
			await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500*5,5,1);
		}
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500*4,4,1);
		expect((await ndContract.currentPriceTier())).to.equal(2);

		//DO TEST -try buy 1 license in first tier
		await expect(
			buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1)
		).to.be.revertedWith("Not in the right price tier");

		//DO TEST -buy 1 license with not enough tokens
		await expect(
			ndContract.connect(secondSigner).buyLicense(1,2)
		).to.be.revertedWith("Insufficient NAEURA balance");

		//DO TEST -buy 1 license in second tier
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,750,1,2);
		let result = await ndContract.ownerOf(90)
		expect(result).to.equal(secondSigner.address);
	})

	it("Buy license - paused contract", async function () { //TODO
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();

		//DO TEST - buy license
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1);
		let result = await ndContract.ownerOf(1)
		expect(result).to.equal(secondSigner.address);

		//DO TEST - pause contract
		await ndContract.connect(owner).pause();

		//DO TEST - try to buy license
		await expect(
			buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1)
		).to.be.revertedWith("Pausable: paused");
	})

	it("Link node", async function () {
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1);

		//DO TEST
		await linkNode(ndContract, secondSigner,1);
		let result = await ndContract.ownerOf(1)
		expect(result).to.equal(secondSigner.address);
		expect((await ndContract.licenses(1)).nodeAddress).to.equal(NODE_ADDRESS);
		expect((await ndContract.registeredNodeAddresses(NODE_ADDRESS))).to.equal(true);

		//DO TEST - try to link again
		await expect(
			linkNode(ndContract, secondSigner,1)
		).to.be.revertedWith("Node address already registered");

		//DO TEST - try to link with wrong license
		await expect(
			linkNode(ndContract, secondSigner,2)
		).to.be.revertedWith("ERC721: invalid token ID");

		//DO TEST - try to link with wrong node address
		await expect(
			ndContract.connect(secondSigner).linkNode(1,NULL_ADDRESS)
		).to.be.revertedWith("Invalid node address");

		//DO TEST - try to link before 24 hrs
		await unlinkNode(ndContract, secondSigner,1);
		await expect(
			linkNode(ndContract, secondSigner,1)
		).to.be.revertedWith( "Cannot reassign within 24 hours");

		//DO TEST - try to link after 24 hrs
		await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
        await ethers.provider.send("evm_mine", []);
		await linkNode(ndContract, secondSigner,1);
	})

	it("Unlink node", async function () {
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1);
		await linkNode(ndContract, secondSigner,1);

		//DO TEST
		await unlinkNode(ndContract, secondSigner,1);
		expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
		expect((await ndContract.registeredNodeAddresses(NODE_ADDRESS))).to.equal(false);
	})

	it("Transfer license", async function () {
		//SETUP WORLD
		const { ndContract,naeuraContract, owner,secondSigner } = await deploy();
		await buyLicenseWithMintAndAllowance(naeuraContract, ndContract, owner, secondSigner,500,1,1);

		//DO TEST - transfer empty license
		await ndContract.connect(secondSigner).transferFrom(secondSigner.address,owner.address,1);
		let result = await ndContract.ownerOf(1)
		expect(result).to.equal(owner.address);
		expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);

		//DO TEST - transfer linked license
		await linkNode(ndContract, owner,1);
		await ndContract.connect(owner).transferFrom(owner.address,secondSigner.address,1);
		let res = await ndContract.ownerOf(1)
		expect(res).to.equal(secondSigner.address);
		expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
	})


})