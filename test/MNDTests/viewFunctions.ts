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


describe("MNDContract - view module", function () {
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

    it('call view getLicenses function', async function () {
        const { mndContract, tokeContract, owner, secondSigner } = await deploy();
        await time.setNextBlockTimestamp(MAINNET_TIMESTAMP);

        await mndContract.addLicense(secondSigner.address, POWER_1);

        const numberMnds = await mndContract.getLicenses(secondSigner.address);
        expect(numberMnds.length).to.eq(1);

        await mndContract.addLicense(secondSigner.address, POWER_5);

        const numberMnds2 = await mndContract.getLicenses(secondSigner.address);
        expect(numberMnds2.length).to.eq(2);
    });


})