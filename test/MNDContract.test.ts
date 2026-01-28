import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployController,
  deployMNDContract,
  deployNDContract,
  deployR1,
  linkNodeWithSignature,
  NODE_ADDRESS,
  NULL_ADDRESS,
  ONE_DAY_IN_SECS,
  ONE_TOKEN,
  revertSnapshotAndCapture,
  setTimestampAndMine,
  signComputeParams,
  signLinkMultiNode,
  signLinkNode,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
} from "./helpers";
import {
  AdoptionOracle,
  Controller,
  MNDContract,
  NDContract,
  R1,
} from "../typechain-types";

// npx hardhat test     ---- for gas usage
// npx hardhat coverage ---- for test coverage

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

const newLpWallet = "0x0000000000000000000000000000000000000001";
const newExpensesWallet = "0x0000000000000000000000000000000000000002";
const newMarketingWallet = "0x0000000000000000000000000000000000000003";
const newGrantsWallet = "0x0000000000000000000000000000000000000004";
const newCsrWallet = "0x0000000000000000000000000000000000000005";
const MULTI_NODE_ADDRESSES = [
  "0x0000000000000000000000000000000000000010",
  "0x0000000000000000000000000000000000000020",
];
const REWARDS_AMOUNT = 106362840848417488913n;
const LICENSE_POWER = 485410n * ONE_TOKEN;
const CLIFF_PERIOD = 223n;
const MND_MAX_MINTING_DURATION = 30 * 30;
const ND_FULL_RELEASE_THRESHOLD = 1;
const POAI_VOLUME_FULL_RELEASE_THRESHOLD = 1;
const POAI_VOLUME_WINDOW_SIZE = 30;

const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: 2n,
  rewardsAmount: REWARDS_AMOUNT,
};

const EXPECTED_LICENSE_INFO = {
  licenseId: 2n,
  nodeAddress: "0x0000000000000000000000000000000000000010",
  totalAssignedAmount: 485410000000000000000000n,
  totalClaimedAmount: 0n,
  firstMiningEpoch: 223n,
  remainingAmount: 485410000000000000000000n,
  lastClaimEpoch: 0n,
  claimableEpochs: 0n,
  assignTimestamp: 1738767602n,
  lastClaimOracle: "0x0000000000000000000000000000000000000000",
};

describe("MNDContract", function () {
  /*
    .##......##..#######..########..##.......########......######...########.##....##.########.########.....###....########.####..#######..##....##
    .##..##..##.##.....##.##.....##.##.......##.....##....##....##..##.......###...##.##.......##.....##...##.##......##.....##..##.....##.###...##
    .##..##..##.##.....##.##.....##.##.......##.....##....##........##.......####..##.##.......##.....##..##...##.....##.....##..##.....##.####..##
    .##..##..##.##.....##.########..##.......##.....##....##...####.######...##.##.##.######...########..##.....##....##.....##..##.....##.##.##.##
    .##..##..##.##.....##.##...##...##.......##.....##....##....##..##.......##..####.##.......##...##...#########....##.....##..##.....##.##..####
    .##..##..##.##.....##.##....##..##.......##.....##....##....##..##.......##...###.##.......##....##..##.....##....##.....##..##.....##.##...###
    ..###..###...#######..##.....##.########.########......######...########.##....##.########.##.....##.##.....##....##....####..#######..##....##
    */

  let mndContract: MNDContract;
  let ndContract: NDContract;
  let r1Contract: R1;
  let controllerContract: Controller;
  let adoptionOracle: AdoptionOracle;
  let owner: HardhatEthersSigner;
  let firstUser: HardhatEthersSigner;
  let secondUser: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let COMPUTE_PARAMS = {
    licenseId: 2,
    nodeAddress: NODE_ADDRESS,
    epochs: [223, 224, 225, 226, 227],
    availabilies: [250, 130, 178, 12, 0],
  };
  let snapshotId: string;
  const computeSignatureHex = (signer: HardhatEthersSigner) =>
    signComputeParams({
      signer,
      nodeAddress: COMPUTE_PARAMS.nodeAddress,
      epochs: COMPUTE_PARAMS.epochs,
      availabilities: COMPUTE_PARAMS.availabilies,
    });
  const computeSignatureBytes = (signer: HardhatEthersSigner) =>
    computeSignatureHex(signer).then((signature) => ethers.getBytes(signature));

  before(async function () {
    const [deployer, user1, user2, oracleSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    oracle = oracleSigner;

    controllerContract = await deployController({
      owner,
      oracleSigners: [oracle],
    });
    r1Contract = await deployR1(owner);
    mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await mndContract.setNDContract(await ndContract.getAddress());

    const AdoptionOracleFactory = await ethers.getContractFactory(
      "AdoptionOracle"
    );
    adoptionOracle = await upgrades.deployProxy(
      AdoptionOracleFactory,
      [
        await owner.getAddress(),
        await ndContract.getAddress(),
        await owner.getAddress(),
        ND_FULL_RELEASE_THRESHOLD,
        POAI_VOLUME_FULL_RELEASE_THRESHOLD,
        POAI_VOLUME_WINDOW_SIZE,
      ],
      { initializer: "initialize" }
    );
    await adoptionOracle.waitForDeployment();
    await adoptionOracle.initializeLicenseSales([0], [2]);
    await mndContract.setAdoptionOracle(await adoptionOracle.getAddress());

    await r1Contract.setNdContract(await owner.getAddress());
    await r1Contract.setMndContract(await mndContract.getAddress());

    snapshotId = await takeSnapshot();
  });
  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    await setTimestampAndMine(START_EPOCH_TIMESTAMP);
  });

  afterEach(async function () {
    COMPUTE_PARAMS = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [223, 224, 225, 226, 227],
      availabilies: [250, 130, 178, 12, 0],
    };
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  /*
    .##.....##.########.####.##........######.
    .##.....##....##.....##..##.......##....##
    .##.....##....##.....##..##.......##......
    .##.....##....##.....##..##........######.
    .##.....##....##.....##..##.............##
    .##.....##....##.....##..##.......##....##
    ..#######.....##....####.########..######.
    */

  async function linkNode(
    mndContract: MNDContract,
    user: HardhatEthersSigner,
    licenseId: number
  ) {
    await linkNodeWithSignature({
      contract: mndContract,
      user,
      licenseId,
      nodeAddress: NODE_ADDRESS,
      oracleSigner: oracle,
    });
  }

  async function linkMultiNode(
    mndContract: MNDContract,
    user: HardhatEthersSigner,
    licenseIds: number[],
    nodeAddresses: string[]
  ) {
    await mndContract
      .connect(user)
      .linkMultiNode(
        licenseIds,
        nodeAddresses,
        await signLinkMultiNode(oracle, user, nodeAddresses)
      );
  }

  async function unlinkNode(
    ndContract: MNDContract,
    user: HardhatEthersSigner,
    licenseId: number
  ) {
    await ndContract.connect(user).unlinkNode(licenseId);
  }

  async function updateTimestamp() {
    let cliffEpochPased = 30 * 4 * ONE_DAY_IN_SECS;
    let todayCliffEpochPassed =
      START_EPOCH_TIMESTAMP + cliffEpochPased + ONE_DAY_IN_SECS; //Chain start 2 days before contracts, and we need to be one day afetr cliff epoch
    await setTimestampAndMine(todayCliffEpochPassed);
  }

  async function deployAdoptionOracleWithSales(
    epochs: number[],
    totals: number[]
  ) {
    const AdoptionOracleFactory = await ethers.getContractFactory(
      "AdoptionOracle"
    );
    const oracle = await upgrades.deployProxy(
      AdoptionOracleFactory,
      [
        await owner.getAddress(),
        await ndContract.getAddress(),
        await owner.getAddress(),
        ND_FULL_RELEASE_THRESHOLD,
        POAI_VOLUME_FULL_RELEASE_THRESHOLD,
        POAI_VOLUME_WINDOW_SIZE,
      ],
      { initializer: "initialize" }
    );
    await oracle.waitForDeployment();
    await oracle.initializeLicenseSales(epochs, totals);
    return oracle;
  }

  async function deployAdoptionOracleWithData({
    ndThreshold = ND_FULL_RELEASE_THRESHOLD,
    poaiThreshold = POAI_VOLUME_FULL_RELEASE_THRESHOLD,
    licenseEpochs = [],
    licenseTotals = [],
    poaiEpochs = [],
    poaiTotals = [],
  }: {
    ndThreshold?: number;
    poaiThreshold?: number;
    licenseEpochs?: number[];
    licenseTotals?: number[];
    poaiEpochs?: number[];
    poaiTotals?: number[];
  }) {
    const AdoptionOracleFactory = await ethers.getContractFactory(
      "AdoptionOracle"
    );
    const oracle = await upgrades.deployProxy(
      AdoptionOracleFactory,
      [
        await owner.getAddress(),
        await ndContract.getAddress(),
        await owner.getAddress(),
        ndThreshold,
        poaiThreshold,
        POAI_VOLUME_WINDOW_SIZE,
      ],
      { initializer: "initialize" }
    );
    await oracle.waitForDeployment();
    if (licenseEpochs.length > 0) {
      await oracle.initializeLicenseSales(licenseEpochs, licenseTotals);
    }
    if (poaiEpochs.length > 0) {
      await oracle.initializePoaiVolumes(poaiEpochs, poaiTotals);
    }
    return oracle;
  }

  /*
    .########.########..######..########..######.
    ....##....##.......##....##....##....##....##
    ....##....##.......##..........##....##......
    ....##....######....######.....##.....######.
    ....##....##.............##....##..........##
    ....##....##.......##....##....##....##....##
    ....##....########..######.....##.....######.
    */

  it("Supports interface - should work", async function () {
    //ERC721
    expect(await mndContract.supportsInterface("0x80ac58cd")).to.be.true;
  });

  it("Set base uri- should work", async function () {
    let baseUri = "PIPPO.com/";
    await mndContract.setBaseURI(baseUri);
  });

  it("Set base uri - not the owner", async function () {
    let baseUri = "PIPPO.com/";
    await expect(
      mndContract.connect(firstUser).setBaseURI(baseUri)
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Get token uri", async function () {
    let baseUri = "PIPPO.com/";
    await mndContract.setBaseURI(baseUri);

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    let result = await mndContract.tokenURI(1n);
    expect(baseUri).to.equal(result);
  });

  it("Set nd contract - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract
        .connect(firstUser)
        .setNDContract(await secondUser.getAddress())
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Set adoption oracle - should work", async function () {
    const oracle = await deployAdoptionOracleWithSales([0], [2]);
    await mndContract.setAdoptionOracle(await oracle.getAddress());
  });

  it("Set adoption oracle - invalid address", async function () {
    await expect(
      mndContract.setAdoptionOracle(NULL_ADDRESS)
    ).to.be.revertedWith("Invalid adoption oracle");
  });

  it("Set adoption oracle - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract.connect(firstUser).setAdoptionOracle(await owner.getAddress())
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Set max carryover release factor - should work", async function () {
    await mndContract.setMaxCarryoverReleaseFactor(200);
    expect(await mndContract.maxCarryoverReleaseFactor()).to.equal(200);
  });

  it("Set max carryover release factor - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract.connect(firstUser).setMaxCarryoverReleaseFactor(200)
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Get licenses - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    const nodeAddress = "0x0000000000000000000000000000000000000010";
    await mndContract
      .connect(firstUser)
      .linkNode(
        2,
        nodeAddress,
        await signLinkNode(oracle, firstUser, nodeAddress)
      );
    await updateTimestamp();

    let result = await mndContract.getLicenses(await firstUser.getAddress());
    expect(EXPECTED_LICENSE_INFO).to.deep.equal({
      licenseId: result[0].licenseId,
      nodeAddress: result[0].nodeAddress,
      totalAssignedAmount: result[0].totalAssignedAmount,
      totalClaimedAmount: result[0].totalClaimedAmount,
      firstMiningEpoch: result[0].firstMiningEpoch,
      remainingAmount: result[0].remainingAmount,
      lastClaimEpoch: result[0].lastClaimEpoch,
      claimableEpochs: result[0].claimableEpochs,
      assignTimestamp: result[0].assignTimestamp,
      lastClaimOracle: result[0].lastClaimOracle,
    });
  });

  it("Get licenses - cliff epoch not reached", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    let _EXPECTED_LICENSE_INFO = { ...EXPECTED_LICENSE_INFO };
    _EXPECTED_LICENSE_INFO.nodeAddress =
      "0x0000000000000000000000000000000000000000";
    _EXPECTED_LICENSE_INFO.assignTimestamp = 0n;

    let result = await mndContract.getLicenses(await firstUser.getAddress());
    expect(_EXPECTED_LICENSE_INFO).to.deep.equal({
      licenseId: result[0].licenseId,
      nodeAddress: result[0].nodeAddress,
      totalAssignedAmount: result[0].totalAssignedAmount,
      totalClaimedAmount: result[0].totalClaimedAmount,
      firstMiningEpoch: result[0].firstMiningEpoch,
      remainingAmount: result[0].remainingAmount,
      lastClaimEpoch: result[0].lastClaimEpoch,
      claimableEpochs: result[0].claimableEpochs,
      assignTimestamp: result[0].assignTimestamp,
      lastClaimOracle: result[0].lastClaimOracle,
    });
  });

  it("Get licenses - user has no license", async function () {
    let result = await mndContract.getLicenses(await firstUser.getAddress());
    expect([]).to.deep.equal(result);
  });

  it("Get licenses - genesis license", async function () {
    const nodeAddress = "0x0000000000000000000000000000000000000010";
    await mndContract
      .connect(owner)
      .linkNode(1, nodeAddress, await signLinkNode(oracle, owner, nodeAddress));

    let _EXPECTED_LICENSE_INFO = { ...EXPECTED_LICENSE_INFO };
    _EXPECTED_LICENSE_INFO.licenseId = 1n;
    _EXPECTED_LICENSE_INFO.remainingAmount = 46761182022000000000000000n;
    _EXPECTED_LICENSE_INFO.totalAssignedAmount = 46761182022000000000000000n;
    _EXPECTED_LICENSE_INFO.assignTimestamp = 1738767601n;
    _EXPECTED_LICENSE_INFO.firstMiningEpoch = 1n;
    _EXPECTED_LICENSE_INFO.claimableEpochs = 0n;
    let result = await mndContract.getLicenses(await owner.getAddress());
    expect(_EXPECTED_LICENSE_INFO).to.deep.equal({
      licenseId: result[0].licenseId,
      nodeAddress: result[0].nodeAddress,
      totalAssignedAmount: result[0].totalAssignedAmount,
      totalClaimedAmount: result[0].totalClaimedAmount,
      firstMiningEpoch: result[0].firstMiningEpoch,
      remainingAmount: result[0].remainingAmount,
      lastClaimEpoch: result[0].lastClaimEpoch,
      claimableEpochs: result[0].claimableEpochs,
      assignTimestamp: result[0].assignTimestamp,
      lastClaimOracle: result[0].lastClaimOracle,
    });
  });

  it("Set company wallet - should work", async function () {
    await mndContract.setCompanyWallets(
      newLpWallet,
      newExpensesWallet,
      newMarketingWallet,
      newGrantsWallet,
      newCsrWallet
    );
  });

  it("Set company wallet - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract
        .connect(firstUser)
        .setCompanyWallets(
          newLpWallet,
          newExpensesWallet,
          newMarketingWallet,
          newGrantsWallet,
          newCsrWallet
        )
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Genesis node - owner has ownership", async function () {
    let ownerOfGenesis = await mndContract.ownerOf(1n);
    expect(await owner.getAddress()).to.equal(ownerOfGenesis);
  });

  it("Add license - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    let ownerOfLiense = await mndContract.ownerOf(2n);
    expect(await firstUser.getAddress()).to.equal(ownerOfLiense);
    expect(await mndContract.totalLicensesAssignedTokensAmount()).to.be.equal(
      485410000000000000000000n
    );
  });

  it("Add license - invalid license power", async function () {
    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), LICENSE_POWER * ONE_TOKEN)
    ).to.be.revertedWith("Invalid license power");
  });

  it("Add license - power limit reached", async function () {
    await Promise.all(
      (await ethers.getSigners())
        .slice(7, 20)
        .map(async (signer) =>
          mndContract
            .connect(owner)
            .addLicense(await signer.getAddress(), ONE_TOKEN * 3236067n)
        )
    );

    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), ONE_TOKEN * 3236067n)
    ).to.be.revertedWith("Max total assigned tokens reached");
  });

  it("Add license - paused contract", async function () {
    //SETUP WORLD
    await mndContract.connect(owner).pause();

    //DO TEST - try to buy license
    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), LICENSE_POWER)
    ).to.be.revertedWithCustomError(mndContract, "EnforcedPause");
  });

  it("Add license - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract
        .connect(firstUser)
        .addLicense(await firstUser.getAddress(), LICENSE_POWER * ONE_TOKEN)
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Add license - maximum token supply reached", async function () {
    const licensePromises = [];

    for (let i = 0; i < 499; i++) {
      const user_addr = "0x" + (i + 2).toString(16).padStart(40, "0");
      licensePromises.push(mndContract.connect(owner).addLicense(user_addr, 1));
    }

    await Promise.all(licensePromises);

    await expect(
      mndContract.connect(owner).addLicense(await firstUser.getAddress(), 1)
    ).to.be.revertedWith("Maximum token supply reached.");
  });

  it("Add license - max total assigned tokens reached", async function () {
    //Give all tokens
    for (let i = 0; i < 13; i++) {
      const user_addr = "0x" + (i + 1).toString(16).padStart(40, "0");
      await mndContract
        .connect(owner)
        .addLicense(user_addr, (ONE_TOKEN * 323606796n) / 100n);
    }

    await mndContract
      .connect(owner)
      .addLicense(
        await secondUser.getAddress(),
        (ONE_TOKEN * 161803398n) / 1000n
      );

    //Should revert
    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), ONE_TOKEN)
    ).to.be.revertedWith("Max total assigned tokens reached");
  });

  it("Pause contract - should work", async function () {
    await mndContract.connect(owner).pause();
    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), LICENSE_POWER)
    ).to.be.revertedWithCustomError(mndContract, "EnforcedPause");
  });

  it("Pause contract - not the owner", async function () {
    await expect(
      mndContract.connect(firstUser).pause()
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Unpause contract - should work", async function () {
    await mndContract.connect(owner).pause();
    await expect(
      mndContract
        .connect(owner)
        .addLicense(await firstUser.getAddress(), LICENSE_POWER)
    ).to.be.revertedWithCustomError(mndContract, "EnforcedPause");

    await mndContract.connect(owner).unpause();

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
  });

  it("Unpause contract - not the owner", async function () {
    await mndContract.connect(owner).pause();
    await expect(
      mndContract.connect(firstUser).unpause()
    ).to.be.revertedWithCustomError(mndContract, "OwnableUnauthorizedAccount");
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .linkNode(
          2,
          NODE_ADDRESS,
          await signLinkNode(oracle, firstUser, NODE_ADDRESS)
        )
    ).to.emit(mndContract, "LinkNode");
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(await firstUser.getAddress());
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NODE_ADDRESS);
    expect(await mndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      true
    );
  });

  it("Link multi node - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    const licenseIds = [2, 3];
    await linkMultiNode(mndContract, firstUser, licenseIds, MULTI_NODE_ADDRESSES);

    for (let i = 0; i < licenseIds.length; i++) {
      const licenseId = licenseIds[i];
      const nodeAddress = MULTI_NODE_ADDRESSES[i];
      expect((await mndContract.licenses(licenseId)).nodeAddress).to.equal(
        nodeAddress
      );
      expect(await mndContract.registeredNodeAddresses(nodeAddress)).to.equal(
        true
      );
      expect(await mndContract.nodeToLicenseId(nodeAddress)).to.equal(licenseId);
    }
  });

  it("Link multi node - mismatched arrays length", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    const licenseIds = [2, 3];
    const nodeAddresses = [MULTI_NODE_ADDRESSES[0]];
    await expect(
      mndContract
        .connect(firstUser)
        .linkMultiNode(
          licenseIds,
          nodeAddresses,
          await signLinkMultiNode(oracle, firstUser, nodeAddresses)
        )
    ).to.be.revertedWith("Mismatched input arrays length");
  });

  it("Link multi node - not the owner of the license", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await mndContract
      .connect(owner)
      .addLicense(await secondUser.getAddress(), LICENSE_POWER);

    await expect(
      linkMultiNode(mndContract, firstUser, [2, 3], MULTI_NODE_ADDRESSES)
    ).to.be.revertedWith("Not the owner of the license");
  });

  it("Link multi node - link again before 24hrs", async function () {
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    await linkNode(mndContract, firstUser, 2);
    await unlinkNode(mndContract, firstUser, 2);

    await expect(
      linkMultiNode(mndContract, firstUser, [2], [MULTI_NODE_ADDRESSES[0]])
    ).to.be.revertedWith("Cannot reassign within 24 hours");
  });

  it("Link node - address already registered", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    //DO TEST - try to link again
    await expect(linkNode(mndContract, firstUser, 2)).to.be.revertedWith(
      "Node address already registered"
    );
  });

  it("Link node - not the owner of the license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    //DO TEST - try to link again
    await expect(linkNode(mndContract, secondUser, 2)).to.be.revertedWith(
      "Not the owner of the license"
    );
  });

  it("Link node - wrong license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - try to link with wrong license
    await expect(
      linkNode(mndContract, firstUser, 3)
    ).to.be.revertedWithCustomError(mndContract, "ERC721NonexistentToken");
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - try to link with wrong node address
    await expect(
      mndContract
        .connect(firstUser)
        .linkNode(
          2,
          NULL_ADDRESS,
          await signLinkNode(oracle, firstUser, NULL_ADDRESS)
        )
    ).to.be.revertedWith("Invalid node address");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    //DO TEST - try to link before 24 hrs
    await unlinkNode(mndContract, firstUser, 2);
    await expect(linkNode(mndContract, firstUser, 2)).to.be.revertedWith(
      "Cannot reassign within 24 hours"
    );
  });

  it("Link node - link again after 24hrs", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await unlinkNode(mndContract, firstUser, 2);

    //DO TEST - try to link after 24 hrs
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);
    await linkNode(mndContract, firstUser, 2);
  });

  it("Unlink node - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    //DO TEST
    await expect(mndContract.connect(firstUser).unlinkNode(2)).to.emit(
      mndContract,
      "UnlinkNode"
    );
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NULL_ADDRESS);
    expect(await mndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      false
    );
  });

  it("Unlink node - not the owner", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    //DO TEST
    await expect(
      mndContract.connect(secondUser).unlinkNode(2)
    ).to.be.revertedWith("Not the owner of the license");
  });

  it("Unlink - unlink before claiming rewards, cliff not passed", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await updateTimestamp();
    //DO TEST
    await expect(mndContract.connect(firstUser).unlinkNode(2)).not.to.be
      .reverted;
  });

  it("Unlink - unlink before claiming rewards, cliff passed", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await updateTimestamp();

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * Number(CLIFF_PERIOD),
    ]); //surpass the cliff epochs
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract.connect(firstUser).unlinkNode(2)
    ).to.be.revertedWith("Cannot unlink before claiming rewards");
  });

  it("Calculate rewards", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let result = await mndContract.calculateRewards([COMPUTE_PARAMS]);
    expect({
      licenseId: result[0].licenseId,
      rewardsAmount: result[0].rewardsAmount,
    }).to.deep.equal(EXPECTED_COMPUTE_REWARDS_RESULT);
  });

  it("Calculate rewards to be in line with simulation", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), 100000_000000000000000000n);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1), //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let result = await mndContract.calculateRewards([
      {
        licenseId: 2,
        nodeAddress: NODE_ADDRESS,
        epochs: [223],
        availabilies: [255],
      },
    ]);
    expect({
      licenseId: result[0].licenseId,
      rewardsAmount: result[0].rewardsAmount,
    }).to.deep.equal({
      licenseId: 2n,
      rewardsAmount: 9754316031215612969n,
    });
  });

  it("Adoption gating - withholds rewards into AWB when adoption is zero", async function () {
    const adoptionOracleOverride = await deployAdoptionOracleWithSales(
      [0],
      [0]
    );
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const zeroAdoptionParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [Number(CLIFF_PERIOD)],
      availabilies: [255],
    };
    const zeroAdoptionSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: zeroAdoptionParams.nodeAddress,
      epochs: zeroAdoptionParams.epochs,
      availabilities: zeroAdoptionParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [zeroAdoptionParams],
        [[ethers.getBytes(zeroAdoptionSignature)]]
      );

    const awbBalance = await mndContract.awbBalances(2);
    const license = await mndContract.licenses(2);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      0n
    );
    expect(awbBalance).to.be.gt(0n);
    expect(license.totalClaimedAmount).to.equal(awbBalance);
  });

  it("Adoption gating - releases carryover when adoption increases", async function () {
    const adoptionOracleOverride = await deployAdoptionOracleWithSales(
      [0, Number(CLIFF_PERIOD) + 1],
      [0, 2]
    );
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 2),
    ]);
    await ethers.provider.send("evm_mine", []);

    const params = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [Number(CLIFF_PERIOD), Number(CLIFF_PERIOD) + 1],
      availabilies: [255, 255],
    };
    const paramsSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: params.nodeAddress,
      epochs: params.epochs,
      availabilities: params.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([params], [[ethers.getBytes(paramsSignature)]]);

    const awbBalance = await mndContract.awbBalances(2);
    const license = await mndContract.licenses(2);
    const minted = await r1Contract.balanceOf(await firstUser.getAddress());
    expect(awbBalance).to.equal(0n);
    expect(minted).to.equal(license.totalClaimedAmount);
    expect(minted).to.be.gt(0n);
  });

  it("Adoption gating - increasing thresholds lowers adoption after a claim", async function () {
    const epochOne = Number(CLIFF_PERIOD);
    const epochTwo = epochOne + 1;
    const initialThreshold = 1000;
    const higherThreshold = 2000;
    const totals = 1000;

    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      ndThreshold: initialThreshold,
      poaiThreshold: initialThreshold,
      licenseEpochs: [epochOne, epochTwo],
      licenseTotals: [totals, totals],
      poaiEpochs: [epochOne, epochTwo],
      poaiTotals: [totals, totals],
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochOneParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochOne],
      availabilies: [255],
    };
    const epochOneSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochOneParams.nodeAddress,
      epochs: epochOneParams.epochs,
      availabilities: epochOneParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochOneParams], [[ethers.getBytes(epochOneSignature)]]);

    const awbAfterFirst = await mndContract.awbBalances(2);
    expect(awbAfterFirst).to.equal(0n);

    await adoptionOracleOverride
      .connect(owner)
      .setNdFullReleaseThreshold(higherThreshold);
    await adoptionOracleOverride
      .connect(owner)
      .setPoaiVolumeFullReleaseThreshold(
        higherThreshold,
        POAI_VOLUME_WINDOW_SIZE
      );

    const adoptionPercentEpochTwo =
      await adoptionOracleOverride.getAdoptionPercentageAtEpoch(epochTwo);
    expect(adoptionPercentEpochTwo).to.be.lt(255n);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochTwoParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochTwo],
      availabilies: [255],
    };
    const epochTwoSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochTwoParams.nodeAddress,
      epochs: epochTwoParams.epochs,
      availabilities: epochTwoParams.availabilies,
    });
    const mintedBeforeSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseBeforeSecond = await mndContract.licenses(2);
    await mndContract
      .connect(firstUser)
      .claimRewards([epochTwoParams], [[ethers.getBytes(epochTwoSignature)]]);
    const mintedAfterSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedSecond = mintedAfterSecond - mintedBeforeSecond;
    const licenseAfterSecond = await mndContract.licenses(2);
    const awbAfterSecond = await mndContract.awbBalances(2);
    const curveMaxReleaseSecond =
      licenseAfterSecond.totalClaimedAmount -
      licenseBeforeSecond.totalClaimedAmount;
    const expectedAdoptionSecond =
      (curveMaxReleaseSecond * adoptionPercentEpochTwo) / 255n;
    const expectedWithheldSecond =
      curveMaxReleaseSecond - expectedAdoptionSecond;

    expect(mintedSecond).to.equal(expectedAdoptionSecond);
    expect(awbAfterSecond).to.equal(expectedWithheldSecond);
    expect(awbAfterSecond).to.be.gt(0n);
  });

  it("Adoption gating - decreasing thresholds raises adoption after a claim", async function () {
    const epochOne = Number(CLIFF_PERIOD);
    const epochTwo = epochOne + 1;
    const higherThreshold = 2000;
    const lowerThreshold = 1000;
    const totals = 1000;

    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      ndThreshold: higherThreshold,
      poaiThreshold: higherThreshold,
      licenseEpochs: [epochOne, epochTwo],
      licenseTotals: [totals, totals],
      poaiEpochs: [epochOne, epochTwo],
      poaiTotals: [totals, totals],
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochOneParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochOne],
      availabilies: [255],
    };
    const epochOneSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochOneParams.nodeAddress,
      epochs: epochOneParams.epochs,
      availabilities: epochOneParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochOneParams], [[ethers.getBytes(epochOneSignature)]]);

    const adoptionPercentEpochOne =
      await adoptionOracleOverride.getAdoptionPercentageAtEpoch(epochOne);
    const awbAfterFirst = await mndContract.awbBalances(2);
    expect(awbAfterFirst).to.be.gt(0n);

    await adoptionOracleOverride
      .connect(owner)
      .setNdFullReleaseThreshold(lowerThreshold);
    await adoptionOracleOverride
      .connect(owner)
      .setPoaiVolumeFullReleaseThreshold(
        lowerThreshold,
        POAI_VOLUME_WINDOW_SIZE
      );

    const adoptionPercentEpochTwo =
      await adoptionOracleOverride.getAdoptionPercentageAtEpoch(epochTwo);
    expect(adoptionPercentEpochTwo).to.be.gt(adoptionPercentEpochOne);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochTwoParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochTwo],
      availabilies: [255],
    };
    const epochTwoSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochTwoParams.nodeAddress,
      epochs: epochTwoParams.epochs,
      availabilities: epochTwoParams.availabilies,
    });
    const mintedBeforeSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseBeforeSecond = await mndContract.licenses(2);
    await mndContract
      .connect(firstUser)
      .claimRewards([epochTwoParams], [[ethers.getBytes(epochTwoSignature)]]);
    const mintedAfterSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedSecond = mintedAfterSecond - mintedBeforeSecond;
    const licenseAfterSecond = await mndContract.licenses(2);
    const awbAfterSecond = await mndContract.awbBalances(2);
    const curveMaxReleaseSecond =
      licenseAfterSecond.totalClaimedAmount -
      licenseBeforeSecond.totalClaimedAmount;
    const expectedAdoptionSecond =
      (curveMaxReleaseSecond * adoptionPercentEpochTwo) / 255n;
    const expectedWithheldSecond =
      curveMaxReleaseSecond - expectedAdoptionSecond;
    const targetWithheldBuffer =
      (licenseBeforeSecond.totalClaimedAmount *
        (255n - adoptionPercentEpochTwo)) /
      255n;
    const excessAwb =
      awbAfterFirst > targetWithheldBuffer
        ? awbAfterFirst - targetWithheldBuffer
        : 0n;
    const maxCarryoverRelease =
      (curveMaxReleaseSecond *
        (await mndContract.maxCarryoverReleaseFactor())) /
      255n;
    const expectedCarryover =
      excessAwb > maxCarryoverRelease ? maxCarryoverRelease : excessAwb;

    expect(mintedSecond).to.equal(expectedAdoptionSecond + expectedCarryover);
    expect(awbAfterSecond).to.equal(
      awbAfterFirst - expectedCarryover + expectedWithheldSecond
    );
    expect(mintedSecond).to.be.gt(expectedAdoptionSecond);
  });

  it("Adoption gating - adoption 0% withholds all rewards", async function () {
    const adoptionOracleOverride = await deployAdoptionOracleWithData({});
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const params = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [Number(CLIFF_PERIOD)],
      availabilies: [255],
    };
    const signature = await signComputeParams({
      signer: oracle,
      nodeAddress: params.nodeAddress,
      epochs: params.epochs,
      availabilities: params.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([params], [[ethers.getBytes(signature)]]);

    const minted = await r1Contract.balanceOf(await firstUser.getAddress());
    const license = await mndContract.licenses(2);
    const awbBalance = await mndContract.awbBalances(2);
    expect(minted).to.equal(0n);
    expect(awbBalance).to.equal(license.totalClaimedAmount);
    expect(awbBalance).to.be.gt(0n);
  });

  it("Adoption gating - adoption 100% mints full availability release", async function () {
    const epoch = Number(CLIFF_PERIOD);
    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      licenseEpochs: [epoch],
      licenseTotals: [2],
      ndThreshold: 1,
      poaiThreshold: 1,
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const params = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epoch],
      availabilies: [255],
    };
    const signature = await signComputeParams({
      signer: oracle,
      nodeAddress: params.nodeAddress,
      epochs: params.epochs,
      availabilities: params.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([params], [[ethers.getBytes(signature)]]);

    const minted = await r1Contract.balanceOf(await firstUser.getAddress());
    const license = await mndContract.licenses(2);
    const awbBalance = await mndContract.awbBalances(2);
    expect(minted).to.equal(license.totalClaimedAmount);
    expect(awbBalance).to.equal(0n);
  });

  it("Adoption gating - adoption jump releases AWB up to cap", async function () {
    const epochOne = Number(CLIFF_PERIOD);
    const epochTwo = Number(CLIFF_PERIOD) + 1;
    const maxFactor = 10; // out of 255
    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      licenseEpochs: [epochOne, epochTwo],
      licenseTotals: [0, 2],
      ndThreshold: 1,
      poaiThreshold: 1,
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );
    await mndContract.setMaxCarryoverReleaseFactor(maxFactor);

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochOneParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochOne],
      availabilies: [255],
    };
    const epochOneSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochOneParams.nodeAddress,
      epochs: epochOneParams.epochs,
      availabilities: epochOneParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochOneParams], [[ethers.getBytes(epochOneSignature)]]);

    const licenseAfterFirst = await mndContract.licenses(2);
    const awbAfterFirst = await mndContract.awbBalances(2);
    const mintedAfterFirst = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    expect(mintedAfterFirst).to.equal(0n);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochTwoParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochTwo],
      availabilies: [255],
    };
    const epochTwoSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochTwoParams.nodeAddress,
      epochs: epochTwoParams.epochs,
      availabilities: epochTwoParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochTwoParams], [[ethers.getBytes(epochTwoSignature)]]);

    const mintedAfterSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedSecond = mintedAfterSecond - mintedAfterFirst;
    const licenseAfterSecond = await mndContract.licenses(2);
    const awbAfterSecond = await mndContract.awbBalances(2);
    const curveMaxReleaseSecond =
      licenseAfterSecond.totalClaimedAmount -
      licenseAfterFirst.totalClaimedAmount;
    const expectedCap = (curveMaxReleaseSecond * BigInt(maxFactor)) / 255n;
    const carryoverReleased = mintedSecond - curveMaxReleaseSecond;
    expect(carryoverReleased).to.equal(expectedCap);
    expect(awbAfterSecond).to.equal(awbAfterFirst - expectedCap);
  });

  it("Adoption gating - carryover releases even with zero availability", async function () {
    const epochOne = Number(CLIFF_PERIOD);
    const epochTwo = Number(CLIFF_PERIOD) + 1;
    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      licenseEpochs: [epochOne, epochTwo],
      licenseTotals: [0, 2],
      ndThreshold: 1,
      poaiThreshold: 1,
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochOneParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochOne],
      availabilies: [255],
    };
    const epochOneSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochOneParams.nodeAddress,
      epochs: epochOneParams.epochs,
      availabilities: epochOneParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochOneParams], [[ethers.getBytes(epochOneSignature)]]);

    const awbAfterFirst = await mndContract.awbBalances(2);
    const licenseAfterFirst = await mndContract.licenses(2);
    const mintedAfterFirst = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    expect(mintedAfterFirst).to.equal(0n);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochTwoParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochTwo],
      availabilies: [0],
    };
    const epochTwoSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochTwoParams.nodeAddress,
      epochs: epochTwoParams.epochs,
      availabilities: epochTwoParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochTwoParams], [[ethers.getBytes(epochTwoSignature)]]);

    const mintedAfterSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedSecond = mintedAfterSecond - mintedAfterFirst;
    const licenseAfterSecond = await mndContract.licenses(2);
    const awbAfterSecond = await mndContract.awbBalances(2);

    expect(licenseAfterSecond.totalClaimedAmount).to.equal(
      licenseAfterFirst.totalClaimedAmount
    );
    expect(mintedSecond).to.equal(awbAfterFirst - awbAfterSecond);
    expect(mintedSecond).to.be.gt(0n);
  });

  it("Adoption gating - carryover cap factor controls release amount", async function () {
    const epochStart = Number(CLIFF_PERIOD);
    const epochsToBuild = 10;
    const epochJump = epochStart + epochsToBuild;
    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      licenseEpochs: [epochStart, epochJump],
      licenseTotals: [0, 2],
      ndThreshold: 1,
      poaiThreshold: 1,
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await mndContract.setMaxCarryoverReleaseFactor(0);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (epochStart + epochsToBuild),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochParams = Array.from(
      { length: epochsToBuild },
      (_, i) => epochStart + i
    );
    const availParams = Array.from({ length: epochsToBuild }, () => 255);
    const buildParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: epochParams,
      availabilies: availParams,
    };
    const buildSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: buildParams.nodeAddress,
      epochs: buildParams.epochs,
      availabilities: buildParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([buildParams], [[ethers.getBytes(buildSignature)]]);

    const awbAfterBuild = await mndContract.awbBalances(2);
    expect(awbAfterBuild).to.be.gt(0n);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochJumpParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochJump],
      availabilies: [255],
    };
    const epochJumpSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochJumpParams.nodeAddress,
      epochs: epochJumpParams.epochs,
      availabilities: epochJumpParams.availabilies,
    });
    const mintedBeforeJump = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseBeforeJump = await mndContract.licenses(2);
    await mndContract
      .connect(firstUser)
      .claimRewards([epochJumpParams], [[ethers.getBytes(epochJumpSignature)]]);
    const mintedAfterJump = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseAfterJump = await mndContract.licenses(2);
    const awbAfterJump = await mndContract.awbBalances(2);
    const curveMaxReleaseJump =
      licenseAfterJump.totalClaimedAmount -
      licenseBeforeJump.totalClaimedAmount;
    expect(mintedAfterJump - mintedBeforeJump).to.equal(curveMaxReleaseJump);
    expect(awbAfterJump).to.equal(awbAfterBuild);

    const halfFactor = 127;
    await mndContract.setMaxCarryoverReleaseFactor(halfFactor);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochNextParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochJump + 1],
      availabilies: [255],
    };
    const epochNextSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochNextParams.nodeAddress,
      epochs: epochNextParams.epochs,
      availabilities: epochNextParams.availabilies,
    });
    const mintedBeforeNext = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseBeforeNext = await mndContract.licenses(2);
    await mndContract
      .connect(firstUser)
      .claimRewards([epochNextParams], [[ethers.getBytes(epochNextSignature)]]);
    const mintedAfterNext = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseAfterNext = await mndContract.licenses(2);
    const awbAfterNext = await mndContract.awbBalances(2);
    const curveMaxReleaseNext =
      licenseAfterNext.totalClaimedAmount -
      licenseBeforeNext.totalClaimedAmount;
    const expectedCap = (curveMaxReleaseNext * BigInt(halfFactor)) / 255n;
    const mintedNext = mintedAfterNext - mintedBeforeNext;
    const carryoverReleased = mintedNext - curveMaxReleaseNext;
    expect(carryoverReleased).to.equal(expectedCap);
    expect(awbAfterNext).to.equal(awbAfterJump - expectedCap);
  });

  it("Adoption gating - post-vesting curve flattens and drains AWB", async function () {
    const plateauEpoch = Number(CLIFF_PERIOD) + MND_MAX_MINTING_DURATION;
    const adoptionOracleOverride = await deployAdoptionOracleWithData({
      licenseEpochs: [plateauEpoch],
      licenseTotals: [2],
      ndThreshold: 1,
      poaiThreshold: 1,
    });
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );
    await mndContract.setMaxCarryoverReleaseFactor(10); // out of 255

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * plateauEpoch,
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochsToClaim = plateauEpoch - Number(CLIFF_PERIOD);
    const epochRange = Array.from(
      { length: epochsToClaim },
      (_, i) => Number(CLIFF_PERIOD) + i
    );
    const availRange = Array.from({ length: epochsToClaim }, () => 255);
    const earlyParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: epochRange,
      availabilies: availRange,
    };
    const earlySignature = await signComputeParams({
      signer: oracle,
      nodeAddress: earlyParams.nodeAddress,
      epochs: earlyParams.epochs,
      availabilities: earlyParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([earlyParams], [[ethers.getBytes(earlySignature)]]);

    const awbAfterEarly = await mndContract.awbBalances(2);
    const licenseAfterEarly = await mndContract.licenses(2);
    const mintedAfterEarly = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    expect(mintedAfterEarly).to.equal(0n);
    expect(awbAfterEarly).to.equal(LICENSE_POWER);

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const plateauParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [plateauEpoch],
      availabilies: [255],
    };
    const plateauSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: plateauParams.nodeAddress,
      epochs: plateauParams.epochs,
      availabilities: plateauParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([plateauParams], [[ethers.getBytes(plateauSignature)]]);

    const mintedAfterPlateau = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedPlateau = mintedAfterPlateau - mintedAfterEarly;
    const licenseAfterPlateau = await mndContract.licenses(2);
    const awbAfterPlateau = await mndContract.awbBalances(2);
    const curveMaxReleasePlateau =
      licenseAfterPlateau.totalClaimedAmount -
      licenseAfterEarly.totalClaimedAmount;
    const carryoverPlateau = mintedPlateau - curveMaxReleasePlateau;

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const plateauNextParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [plateauEpoch + 1],
      availabilies: [255],
    };
    const plateauNextSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: plateauNextParams.nodeAddress,
      epochs: plateauNextParams.epochs,
      availabilities: plateauNextParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [plateauNextParams],
        [[ethers.getBytes(plateauNextSignature)]]
      );

    const mintedAfterPlateauNext = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedPlateauNext = mintedAfterPlateauNext - mintedAfterPlateau;
    const licenseAfterPlateauNext = await mndContract.licenses(2);
    const awbAfterPlateauNext = await mndContract.awbBalances(2);
    const curveMaxReleasePlateauNext =
      licenseAfterPlateauNext.totalClaimedAmount -
      licenseAfterPlateau.totalClaimedAmount;
    const carryoverPlateauNext = mintedPlateauNext - curveMaxReleasePlateauNext;

    expect(curveMaxReleasePlateauNext).to.equal(curveMaxReleasePlateau);
    expect(carryoverPlateauNext).to.equal(carryoverPlateau);
    expect(awbAfterPlateau).to.equal(awbAfterEarly - carryoverPlateau);
    expect(awbAfterPlateauNext).to.equal(
      awbAfterPlateau - carryoverPlateauNext
    );
    expect(carryoverPlateau).to.be.gt(0n);
    expect(LICENSE_POWER).to.equal(
      mintedAfterPlateauNext + awbAfterPlateauNext
    );
  });

  it("Adoption gating - 50% adoption then 75% adoption releases 50% AWB", async function () {
    const adoptionHalf = 500;
    const adoptionSeventyFive = 750;
    const adoptionThreshold = 1000;
    const epochOne = Number(CLIFF_PERIOD);
    const epochTwo = Number(CLIFF_PERIOD) + 1;

    const AdoptionOracleFactory = await ethers.getContractFactory(
      "AdoptionOracle"
    );
    const adoptionOracleOverride = await upgrades.deployProxy(
      AdoptionOracleFactory,
      [
        await owner.getAddress(),
        await ndContract.getAddress(),
        await owner.getAddress(),
        adoptionThreshold,
        adoptionThreshold,
        POAI_VOLUME_WINDOW_SIZE,
      ],
      { initializer: "initialize" }
    );
    await adoptionOracleOverride.waitForDeployment();
    await adoptionOracleOverride.initializeLicenseSales(
      [epochOne, epochTwo],
      [adoptionHalf, adoptionSeventyFive]
    );
    await adoptionOracleOverride.initializePoaiVolumes(
      [epochOne, epochTwo],
      [adoptionHalf, adoptionSeventyFive]
    );
    await mndContract.setAdoptionOracle(
      await adoptionOracleOverride.getAddress()
    );

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    const epochOneParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochOne],
      availabilies: [255],
    };
    const epochOneSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochOneParams.nodeAddress,
      epochs: epochOneParams.epochs,
      availabilities: epochOneParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochOneParams], [[ethers.getBytes(epochOneSignature)]]);

    const balanceAfterFirst = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const licenseAfterFirst = await mndContract.licenses(2);
    const awbAfterFirst = await mndContract.awbBalances(2);
    const adoptionPercentEpochOne =
      await adoptionOracleOverride.getAdoptionPercentageAtEpoch(epochOne);
    const expectedMintedFirst =
      (licenseAfterFirst.totalClaimedAmount * adoptionPercentEpochOne) / 255n;
    expect(balanceAfterFirst).to.equal(expectedMintedFirst);
    expect(awbAfterFirst).to.equal(
      licenseAfterFirst.totalClaimedAmount - expectedMintedFirst
    );

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);

    const epochTwoParams = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [epochTwo],
      availabilies: [255],
    };
    const epochTwoSignature = await signComputeParams({
      signer: oracle,
      nodeAddress: epochTwoParams.nodeAddress,
      epochs: epochTwoParams.epochs,
      availabilities: epochTwoParams.availabilies,
    });
    await mndContract
      .connect(firstUser)
      .claimRewards([epochTwoParams], [[ethers.getBytes(epochTwoSignature)]]);

    const balanceAfterSecond = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    const mintedSecond = balanceAfterSecond - balanceAfterFirst;
    const licenseAfterSecond = await mndContract.licenses(2);
    const awbAfterSecond = await mndContract.awbBalances(2);
    const curveMaxReleaseSecond =
      licenseAfterSecond.totalClaimedAmount -
      licenseAfterFirst.totalClaimedAmount;
    const adoptionPercentEpochTwo =
      await adoptionOracleOverride.getAdoptionPercentageAtEpoch(epochTwo);
    const expectedAdoptionSecond =
      (curveMaxReleaseSecond * adoptionPercentEpochTwo) / 255n;
    const expectedWithheldSecond =
      curveMaxReleaseSecond - expectedAdoptionSecond;
    const targetWithheldBuffer =
      (licenseAfterFirst.totalClaimedAmount *
        (255n - adoptionPercentEpochTwo)) /
      255n;
    const expectedCarryover = awbAfterFirst - targetWithheldBuffer;

    const carryoverDelta =
      expectedCarryover * 2n > awbAfterFirst
        ? expectedCarryover * 2n - awbAfterFirst
        : awbAfterFirst - expectedCarryover * 2n;
    expect(carryoverDelta).to.be.lte(2n);
    expect(curveMaxReleaseSecond).to.be.gte(expectedCarryover);
    expect(mintedSecond).to.equal(expectedAdoptionSecond + expectedCarryover);
    expect(awbAfterSecond).to.equal(
      awbAfterFirst - expectedCarryover + expectedWithheldSecond
    );
    expect(mintedSecond).to.be.gt(balanceAfterFirst);
  });

  it("Claim rewards - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5), //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - genesis mnd claim", async function () {
    //SETUP WORLD
    await mndContract.linkNode(
      1,
      NODE_ADDRESS,
      await signLinkNode(oracle, owner, NODE_ADDRESS)
    );
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * 6, //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);
    await mndContract.setCompanyWallets(
      newLpWallet,
      newExpensesWallet,
      newMarketingWallet,
      newGrantsWallet,
      newCsrWallet
    );
    COMPUTE_PARAMS.licenseId = 1;
    COMPUTE_PARAMS.epochs = [1, 2, 3, 4, 5];
    //DO TEST
    await mndContract
      .connect(owner)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(newLpWallet)).to.equal(
      76489386831087123287670n
    );
    expect(await r1Contract.balanceOf(newExpensesWallet)).to.equal(
      39633587186156712328766n
    );
    expect(await r1Contract.balanceOf(newMarketingWallet)).to.equal(
      21592286660666301369862n
    );
    expect(await r1Contract.balanceOf(newGrantsWallet)).to.equal(
      99083967965391780821916n
    );
    expect(await r1Contract.balanceOf(newCsrWallet)).to.equal(
      49570620967656986301369n
    );
  });

  it("Claim rewards - 0 epoch to claim", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5), //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT
    );
    //should not modify amount
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - cliff not reached", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST - should not claim anything
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      0n
    );
  });

  it("Claim rewards - assigned amount reached", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 1),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    for (let i = 0; i < MND_MAX_MINTING_DURATION; i++) {
      COMPUTE_PARAMS.epochs = [Number(CLIFF_PERIOD) + i];
      COMPUTE_PARAMS.availabilies = [255];
      await mndContract
        .connect(firstUser)
        .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
      if (i < MND_MAX_MINTING_DURATION - 1) {
        await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
        await ethers.provider.send("evm_mine", []);
      }
    }
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      LICENSE_POWER
    );

    COMPUTE_PARAMS.epochs = [1830];
    COMPUTE_PARAMS.availabilies = [255];

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      LICENSE_POWER //should not be changed
    );
  });

  it("Claim rewards - user does not have the license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(secondUser)
        .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]])
    ).to.be.revertedWith("User does not have the license");
  });

  it("Claim rewards - invalid signature", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(firstUser)]]
        )
    ).to.be.revertedWith("Invalid oracle signature");
  });

  it("Claim rewards - invalid node address.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.nodeAddress = "0xf2e3878c9ab6a377d331e252f6bf3673d8e87323";
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]])
    ).to.be.revertedWith("Invalid node address.");
  });

  it("Claim rewards - incorrect number of params.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);
    await ethers.provider.send("evm_mine", []);
    COMPUTE_PARAMS.epochs = [1, 2, 3, 4, 5, 6, 7, 8];
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]])
    ).to.be.revertedWith("Incorrect number of params.");
  });

  it("Claim rewards - full history claim with 5 oracles", async function () {
    //SETUP WORLD
    let [oracle1, oracle2, oracle3, oracle4, oracle5] = (
      await ethers.getSigners()
    ).slice(15, 20);
    await controllerContract.addOracle(await oracle1.getAddress());
    await controllerContract.addOracle(await oracle2.getAddress());
    await controllerContract.addOracle(await oracle3.getAddress());
    await controllerContract.addOracle(await oracle4.getAddress());
    await controllerContract.addOracle(await oracle5.getAddress());
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + MND_MAX_MINTING_DURATION),
    ]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < MND_MAX_MINTING_DURATION; i++) {
      COMPUTE_PARAMS.epochs[i] = Number(CLIFF_PERIOD) + i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [
          [
            await computeSignatureBytes(oracle1),
            await computeSignatureBytes(oracle2),
            await computeSignatureBytes(oracle3),
            await computeSignatureBytes(oracle4),
            await computeSignatureBytes(oracle5),
          ],
        ]
      );
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      LICENSE_POWER
    );
  });

  it("Transfer - soulbound: Non-transferable token ", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(
      mndContract
        .connect(firstUser)
        .transferFrom(
          await firstUser.getAddress(),
          await secondUser.getAddress(),
          2
        )
    ).to.be.revertedWith("Soulbound: Non-transferable token");
  });

  it("Set minimum requred signatures - should work", async function () {
    //ERC721
    await controllerContract.setMinimumRequiredSignatures(1n);

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (Number(CLIFF_PERIOD) + 5),
    ]);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Set minimum requred signatures - should not work", async function () {
    //ERC721
    await controllerContract.setMinimumRequiredSignatures(2n);

    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(oracle)]])
    ).to.be.revertedWith("Insufficient signatures");
  });

  it("Transfer - empty license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - transfer empty license
    await mndContract
      .connect(owner)
      .initiateTransfer(
        await firstUser.getAddress(),
        await secondUser.getAddress()
      );
    await mndContract
      .connect(firstUser)
      .transferFrom(
        await firstUser.getAddress(),
        await secondUser.getAddress(),
        2
      );
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(await secondUser.getAddress());
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Transfer - linked license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await mndContract
      .connect(owner)
      .initiateTransfer(
        await firstUser.getAddress(),
        await secondUser.getAddress()
      );

    //DO TEST - transfer linked license
    await mndContract
      .connect(firstUser)
      .transferFrom(
        await firstUser.getAddress(),
        await secondUser.getAddress(),
        2
      );
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(await secondUser.getAddress());
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NODE_ADDRESS);
  });

  it("Transfer - Soulbound", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(
      mndContract
        .connect(firstUser)
        .transferFrom(
          await firstUser.getAddress(),
          await secondUser.getAddress(),
          2
        )
    ).to.be.revertedWith("Soulbound: Non-transferable token");
  });

  it("Burn - empty license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - transfer empty license
    await mndContract.connect(owner).initiateBurn(await firstUser.getAddress());
    await mndContract.connect(firstUser).burn(2);
  });

  it("Burn - linked license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await mndContract.connect(owner).initiateBurn(await firstUser.getAddress());

    //DO TEST - transfer linked license
    await mndContract.connect(firstUser).burn(2);
  });

  it("Burn - Soulbound", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(await firstUser.getAddress(), LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(mndContract.connect(firstUser).burn(2)).to.be.revertedWith(
      "Soulbound: Non-transferable token"
    );
  });
});
