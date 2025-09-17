import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { R1, MNDContract, Controller } from "../../typechain-types";
const BigNumber = ethers.BigNumber;

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

const ONE_TOKEN = BigNumber.from(10).pow(18);
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const newExpensesWallet = "0x0000000000000000000000000000000000000002";
const newMarketingWallet = "0x0000000000000000000000000000000000000003";
const newGrantsWallet = "0x0000000000000000000000000000000000000004";
const newCsrWallet = "0x0000000000000000000000000000000000000005";
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const REWARDS_AMOUNT = BigNumber.from("106362840848417488913");
const LICENSE_POWER = BigNumber.from("485410").mul(ONE_TOKEN);
const CLIFF_PERIOD = BigNumber.from(223);
const MND_MAX_MINTING_DURATION = 30 * 30;

const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: BigNumber.from(2),
  rewardsAmount: REWARDS_AMOUNT,
};

const START_EPOCH_TIMESTAMP = 1738767600;

const EXPECTED_LICENSE_INFO = {
  licenseId: BigNumber.from(2),
  nodeAddress: "0x0000000000000000000000000000000000000010",
  totalAssignedAmount: BigNumber.from("485410000000000000000000"),
  totalClaimedAmount: BigNumber.from(0),
  firstMiningEpoch: BigNumber.from(223),
  remainingAmount: BigNumber.from("485410000000000000000000"),
  lastClaimEpoch: BigNumber.from(0),
  claimableEpochs: BigNumber.from(0),
  assignTimestamp: BigNumber.from(1738767602),
  lastClaimOracle: "0x0000000000000000000000000000000000000000",
};

describe.only("MNDContract", function () {
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
  let r1Contract: R1;
  let controllerContract: Controller;
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let oracle: SignerWithAddress;
  let COMPUTE_PARAMS = {
    licenseId: 2,
    nodeAddress: NODE_ADDRESS,
    epochs: [223, 224, 225, 226, 227],
    availabilies: [250, 130, 178, 12, 0],
  };
  let snapshotId: string;

  before(async function () {
    const [deployer, user1, user2, oracleSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    oracle = oracleSigner;

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      owner.address
    );
    await controllerContract.addOracle(oracle.address);

    const R1Contract = await ethers.getContractFactory("R1");
    r1Contract = await R1Contract.deploy(owner.address);

    const MNDContractFactory = await ethers.getContractFactory("MNDContract");
    mndContract = (await upgrades.deployProxy(
      MNDContractFactory,
      [r1Contract.address, controllerContract.address, owner.address],
      { initializer: "initialize" }
    )) as unknown as MNDContract;

    const NDContractFactory = await ethers.getContractFactory("NDContract");
    const ndContract = await upgrades.deployProxy(
      NDContractFactory,
      [r1Contract.address, controllerContract.address, owner.address],
      { initializer: "initialize" }
    );

    await mndContract.setNDContract(ndContract.address);

    await r1Contract.setNdContract(owner.address);
    await r1Contract.setMndContract(mndContract.address);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });
  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    let daysToAdd = START_EPOCH_TIMESTAMP;
    await ethers.provider.send("evm_setNextBlockTimestamp", [daysToAdd]);
    await ethers.provider.send("evm_mine", []);
  });

  afterEach(async function () {
    COMPUTE_PARAMS = {
      licenseId: 2,
      nodeAddress: NODE_ADDRESS,
      epochs: [223, 224, 225, 226, 227],
      availabilies: [250, 130, 178, 12, 0],
    };
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
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
    user: SignerWithAddress,
    licenseId: number
  ) {
    await mndContract
      .connect(user)
      .linkNode(
        licenseId,
        NODE_ADDRESS,
        signLinkNode(oracle, user, NODE_ADDRESS)
      );
  }

  async function unlinkNode(
    ndContract: MNDContract,
    user: SignerWithAddress,
    licenseId: number
  ) {
    await ndContract.connect(user).unlinkNode(licenseId);
  }

  async function signLinkNode(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    nodeAddress: string
  ) {
    const messageHash = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [user.address, nodeAddress]
    );
    return signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  async function signComputeParams(signer: SignerWithAddress) {
    let messageBytes = Buffer.from(COMPUTE_PARAMS.nodeAddress.slice(2), "hex");

    for (const epoch of COMPUTE_PARAMS.epochs) {
      const epochBytes = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(epoch),
        32
      );
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(epochBytes.slice(2), "hex"),
      ]);
    }

    for (const availability of COMPUTE_PARAMS.availabilies) {
      const availabilityBytes = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(availability),
        32
      );
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(availabilityBytes.slice(2), "hex"),
      ]);
    }

    const messageHash = ethers.utils.keccak256(messageBytes);
    let signature = await signer.signMessage(
      ethers.utils.arrayify(messageHash)
    );
    let signatureBytes = Buffer.from(signature.slice(2), "hex");
    if (signatureBytes[64] < 27) {
      signatureBytes[64] += 27; // Adjust recovery ID
    }

    return signatureBytes.toString("hex");
  }

  async function updateTimestamp() {
    let cliffEpochPased = 30 * 4 * ONE_DAY_IN_SECS;
    let todayCliffEpochPassed =
      START_EPOCH_TIMESTAMP + cliffEpochPased + ONE_DAY_IN_SECS; //Chain start 2 days before contracts, and we need to be one day afetr cliff epoch
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      todayCliffEpochPassed,
    ]);
    await ethers.provider.send("evm_mine", []);
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
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Get token uri", async function () {
    let baseUri = "PIPPO.com/";
    await mndContract.setBaseURI(baseUri);

    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    let result = await mndContract.tokenURI(BigNumber.from(1));
    expect(baseUri).to.equal(result);
  });

  it("Set nd contract - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract.connect(firstUser).setNDContract(secondUser.address)
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Get licenses - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    const nodeAddress = "0x0000000000000000000000000000000000000010";
    await mndContract
      .connect(firstUser)
      .linkNode(2, nodeAddress, signLinkNode(oracle, firstUser, nodeAddress));
    await updateTimestamp();

    let result = await mndContract.getLicenses(firstUser.address);
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
      .addLicense(firstUser.address, LICENSE_POWER);

    let _EXPECTED_LICENSE_INFO = { ...EXPECTED_LICENSE_INFO };
    _EXPECTED_LICENSE_INFO.nodeAddress =
      "0x0000000000000000000000000000000000000000";
    _EXPECTED_LICENSE_INFO.assignTimestamp = BigNumber.from(0);

    let result = await mndContract.getLicenses(firstUser.address);
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
    let result = await mndContract.getLicenses(firstUser.address);
    expect([]).to.deep.equal(result);
  });

  it.only("Get licenses - genesis license", async function () {
    const nodeAddress = "0x0000000000000000000000000000000000000010";
    await mndContract
      .connect(owner)
      .linkNode(1, nodeAddress, signLinkNode(oracle, owner, nodeAddress));

    let _EXPECTED_LICENSE_INFO = { ...EXPECTED_LICENSE_INFO };
    _EXPECTED_LICENSE_INFO.licenseId = BigNumber.from(1);
    _EXPECTED_LICENSE_INFO.remainingAmount = BigNumber.from(
      "46761182022000000000000000"
    );
    _EXPECTED_LICENSE_INFO.totalAssignedAmount = BigNumber.from(
      "46761182022000000000000000"
    );
    _EXPECTED_LICENSE_INFO.assignTimestamp = BigNumber.from(1738767601);
    _EXPECTED_LICENSE_INFO.firstMiningEpoch = BigNumber.from(1);
    _EXPECTED_LICENSE_INFO.claimableEpochs = BigNumber.from(0);
    let result = await mndContract.getLicenses(owner.address);
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
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Genesis node - owner has ownership", async function () {
    let ownerOfGenesis = await mndContract.ownerOf(BigNumber.from(1));
    expect(owner.address).to.equal(ownerOfGenesis);
  });

  it("Add license - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    let ownerOfLiense = await mndContract.ownerOf(BigNumber.from(2));
    expect(firstUser.address).to.equal(ownerOfLiense);
    expect(await mndContract.totalLicensesAssignedTokensAmount()).to.be.equal(
      BigNumber.from("485410000000000000000000")
    );
  });

  it("Add license - invalid license power", async function () {
    await expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, LICENSE_POWER.mul(ONE_TOKEN))
    ).to.be.revertedWith("Invalid license power");
  });

  it("Add license - power limit reached", async function () {
    const a = await Promise.all(
      (await ethers.getSigners())
        .slice(7, 20)
        .map((signer) =>
          mndContract
            .connect(owner)
            .addLicense(signer.address, ONE_TOKEN.mul("3236067"))
        )
    );

    await expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, ONE_TOKEN.mul("3236067"))
    ).to.be.revertedWith("Max total assigned tokens reached");
  });

  it("Add license - paused contract", async function () {
    //SETUP WORLD
    await mndContract.connect(owner).pause();

    //DO TEST - try to buy license
    await expect(
      mndContract.connect(owner).addLicense(firstUser.address, LICENSE_POWER)
    ).to.be.revertedWith("EnforcedPause");
  });

  it("Add license - OwnableUnauthorizedAccount", async function () {
    await expect(
      mndContract
        .connect(firstUser)
        .addLicense(firstUser.address, LICENSE_POWER.mul(ONE_TOKEN))
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Add license - maximum token supply reached", async function () {
    const licensePromises = [];

    for (let i = 0; i < 499; i++) {
      const user_addr = "0x" + (i + 2).toString(16).padStart(40, "0");
      licensePromises.push(mndContract.connect(owner).addLicense(user_addr, 1));
    }

    await Promise.all(licensePromises);

    await expect(
      mndContract.connect(owner).addLicense(firstUser.address, 1)
    ).to.be.revertedWith("Maximum token supply reached.");
  });

  it("Add license - max total assigned tokens reached", async function () {
    //Give all tokens
    for (let i = 0; i < 13; i++) {
      const user_addr = "0x" + (i + 1).toString(16).padStart(40, "0");
      await mndContract
        .connect(owner)
        .addLicense(
          user_addr,
          ONE_TOKEN.mul(BigNumber.from("323606796")).div(100)
        );
    }

    await mndContract
      .connect(owner)
      .addLicense(
        secondUser.address,
        ONE_TOKEN.mul(BigNumber.from("161803398")).div(1000)
      );

    //Should revert
    await expect(
      mndContract.connect(owner).addLicense(firstUser.address, ONE_TOKEN)
    ).to.be.revertedWith("Max total assigned tokens reached");
  });

  it("Pause contract - should work", async function () {
    await mndContract.connect(owner).pause();
    await expect(
      mndContract.connect(owner).addLicense(firstUser.address, LICENSE_POWER)
    ).to.be.revertedWith("EnforcedPause");
  });

  it("Pause contract - not the owner", async function () {
    await expect(mndContract.connect(firstUser).pause()).to.be.revertedWith(
      "OwnableUnauthorizedAccount"
    );
  });

  it("Unpause contract - should work", async function () {
    await mndContract.connect(owner).pause();
    await expect(
      mndContract.connect(owner).addLicense(firstUser.address, LICENSE_POWER)
    ).to.be.revertedWith("EnforcedPause");

    await mndContract.connect(owner).unpause();

    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
  });

  it("Unpause contract - not the owner", async function () {
    await mndContract.connect(owner).pause();
    await expect(mndContract.connect(firstUser).unpause()).to.be.revertedWith(
      "OwnableUnauthorizedAccount"
    );
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .linkNode(
          2,
          NODE_ADDRESS,
          signLinkNode(oracle, firstUser, NODE_ADDRESS)
        )
    ).to.emit(mndContract, "LinkNode");
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(firstUser.address);
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NODE_ADDRESS);
    expect(await mndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      true
    );
  });

  it("Link node - address already registered", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - try to link with wrong license
    await expect(linkNode(mndContract, firstUser, 3)).to.be.revertedWith(
      "ERC721NonexistentToken"
    );
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - try to link with wrong node address
    await expect(
      mndContract
        .connect(firstUser)
        .linkNode(
          2,
          NULL_ADDRESS,
          signLinkNode(oracle, firstUser, NULL_ADDRESS)
        )
    ).to.be.revertedWith("Invalid node address");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
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
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await updateTimestamp();

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * CLIFF_PERIOD.toNumber(),
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
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
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
      .addLicense(firstUser.address, 100000_000000000000000000n);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 1), //one day after cliff
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
      licenseId: BigNumber.from(2n),
      rewardsAmount: BigNumber.from("9754316031215612969"),
    });
  });

  it("Claim rewards - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5), //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - genesis mnd claim", async function () {
    //SETUP WORLD
    await mndContract.linkNode(
      1,
      NODE_ADDRESS,
      signLinkNode(oracle, owner, NODE_ADDRESS)
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
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(newLpWallet)).to.equal(
      BigNumber.from("76489386831087123287670")
    );
    expect(await r1Contract.balanceOf(newExpensesWallet)).to.equal(
      BigNumber.from("39633587186156712328766")
    );
    expect(await r1Contract.balanceOf(newMarketingWallet)).to.equal(
      BigNumber.from("21592286660666301369862")
    );
    expect(await r1Contract.balanceOf(newGrantsWallet)).to.equal(
      BigNumber.from("99083967965391780821916")
    );
    expect(await r1Contract.balanceOf(newCsrWallet)).to.equal(
      BigNumber.from("49570620967656986301369")
    );
  });

  it("Claim rewards - 0 epoch to claim", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5), //one day after cliff
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
    //should not modify amount
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - cliff not reached", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST - should not claim anything
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      BigNumber.from(0)
    );
  });

  it("Claim rewards - assigned amount reached", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + MND_MAX_MINTING_DURATION),
    ]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < MND_MAX_MINTING_DURATION; i++) {
      COMPUTE_PARAMS.epochs[i] = CLIFF_PERIOD.toNumber() + i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      LICENSE_POWER
    );

    COMPUTE_PARAMS.epochs = [1830];
    COMPUTE_PARAMS.availabilies = [255];

    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      LICENSE_POWER //should not be changed
    );
  });

  it("Claim rewards - user does not have the license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(secondUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[Buffer.from(await signComputeParams(oracle), "hex")]]
        )
    ).to.be.revertedWith("User does not have the license");
  });

  it("Claim rewards - invalid signature", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[Buffer.from(await signComputeParams(firstUser), "hex")]]
        )
    ).to.be.revertedWith("Invalid oracle signature");
  });

  it("Claim rewards - invalid node address.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
    ]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.nodeAddress = "0xf2e3878c9ab6a377d331e252f6bf3673d8e87323";
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[Buffer.from(await signComputeParams(oracle), "hex")]]
        )
    ).to.be.revertedWith("Invalid node address.");
  });

  it("Claim rewards - incorrect number of params.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
    ]);
    await ethers.provider.send("evm_mine", []);
    COMPUTE_PARAMS.epochs = [1, 2, 3, 4, 5, 6, 7, 8];
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[Buffer.from(await signComputeParams(oracle), "hex")]]
        )
    ).to.be.revertedWith("Incorrect number of params.");
  });

  it("Claim rewards - full history claim with 5 oracles", async function () {
    //SETUP WORLD
    let [oracle1, oracle2, oracle3, oracle4, oracle5] = (
      await ethers.getSigners()
    ).slice(15, 20);
    await controllerContract.addOracle(oracle1.address);
    await controllerContract.addOracle(oracle2.address);
    await controllerContract.addOracle(oracle3.address);
    await controllerContract.addOracle(oracle4.address);
    await controllerContract.addOracle(oracle5.address);
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + MND_MAX_MINTING_DURATION),
    ]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < MND_MAX_MINTING_DURATION; i++) {
      COMPUTE_PARAMS.epochs[i] = CLIFF_PERIOD.toNumber() + i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [
          [
            Buffer.from(await signComputeParams(oracle1), "hex"),
            Buffer.from(await signComputeParams(oracle2), "hex"),
            Buffer.from(await signComputeParams(oracle3), "hex"),
            Buffer.from(await signComputeParams(oracle4), "hex"),
            Buffer.from(await signComputeParams(oracle5), "hex"),
          ],
        ]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      LICENSE_POWER
    );
  });

  it("Transfer - soulbound: Non-transferable token ", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(
      mndContract
        .connect(firstUser)
        .transferFrom(firstUser.address, secondUser.address, 2)
    ).to.be.revertedWith("Soulbound: Non-transferable token");
  });

  it("Set minimum requred signatures - should work", async function () {
    //ERC721
    await controllerContract.setMinimumRequiredSignatures(BigNumber.from(1));

    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS * (CLIFF_PERIOD.toNumber() + 5),
    ]);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(oracle), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Set minimum requred signatures - should not work", async function () {
    //ERC721
    await controllerContract.setMinimumRequiredSignatures(BigNumber.from(2));

    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[Buffer.from(await signComputeParams(oracle), "hex")]]
        )
    ).to.be.revertedWith("Insufficient signatures");
  });

  it("Transfer - empty license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - transfer empty license
    await mndContract
      .connect(owner)
      .initiateTransfer(firstUser.address, secondUser.address);
    await mndContract
      .connect(firstUser)
      .transferFrom(firstUser.address, secondUser.address, 2);
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(secondUser.address);
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Transfer - linked license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await mndContract
      .connect(owner)
      .initiateTransfer(firstUser.address, secondUser.address);

    //DO TEST - transfer linked license
    await mndContract
      .connect(firstUser)
      .transferFrom(firstUser.address, secondUser.address, 2);
    let result = await mndContract.ownerOf(2);
    expect(result).to.equal(secondUser.address);
    expect((await mndContract.licenses(2)).nodeAddress).to.equal(NODE_ADDRESS);
  });

  it("Transfer - Soulbound", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(
      mndContract
        .connect(firstUser)
        .transferFrom(firstUser.address, secondUser.address, 2)
    ).to.be.revertedWith("Soulbound: Non-transferable token");
  });

  it("Burn - empty license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - transfer empty license
    await mndContract.connect(owner).initiateBurn(firstUser.address);
    await mndContract.connect(firstUser).burn(2);
  });

  it("Burn - linked license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);
    await linkNode(mndContract, firstUser, 2);

    await mndContract.connect(owner).initiateBurn(firstUser.address);

    //DO TEST - transfer linked license
    await mndContract.connect(firstUser).burn(2);
  });

  it("Burn - Soulbound", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, LICENSE_POWER);

    //DO TEST - transfer empty license
    await expect(mndContract.connect(firstUser).burn(2)).to.be.revertedWith(
      "Soulbound: Non-transferable token"
    );
  });
});
