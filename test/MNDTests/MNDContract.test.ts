import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { NAEURA, MNDContract } from "../../typechain-types";
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
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const REWARDS_AMOUNT = BigNumber.from("19561168740964714023");
const COMPUTE_PARAMS = {
  licenseId: 1,
  nodeAddress: NODE_ADDRESS,
  epochs: [1, 2, 3, 4, 5],
  availabilies: [250, 130, 178, 12, 0],
};
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: BigNumber.from(1),
  rewardsAmount: REWARDS_AMOUNT,
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
  let naeuraContract: NAEURA;
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let oracle: SignerWithAddress;

  beforeEach(async function () {
    const [deployer, user1, user2, oracleSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    oracle = oracleSigner;

    const NAEURAContract = await ethers.getContractFactory("NAEURA");
    naeuraContract = await NAEURAContract.deploy();

    const MNDContract = await ethers.getContractFactory("MNDContract");
    mndContract = await MNDContract.deploy(
      naeuraContract.address,
      oracle.address
    );

    await naeuraContract.setNdContract(owner.address);
    await naeuraContract.setMndContract(mndContract.address);
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
    await mndContract.connect(user).linkNode(licenseId, NODE_ADDRESS);
  }

  async function unlinkNode(
    ndContract: MNDContract,
    user: SignerWithAddress,
    licenseId: number
  ) {
    await ndContract.connect(user).unlinkNode(licenseId);
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

  /*
    .########.########..######..########..######.
    ....##....##.......##....##....##....##....##
    ....##....##.......##..........##....##......
    ....##....######....######.....##.....######.
    ....##....##.............##....##..........##
    ....##....##.......##....##....##....##....##
    ....##....########..######.....##.....######.
    */

  it("Genesis node - owner has ownership", async function () {
    let ownerOfGenesis = await mndContract.ownerOf(BigNumber.from(0));
    expect(owner.address).to.equal(ownerOfGenesis);
  });

  it("Add license - should work", async function () {
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    let ownerOfLiense = await mndContract.ownerOf(BigNumber.from(1));
    expect(firstUser.address).to.equal(ownerOfLiense);
  });

  it("Add license - invalid license power", async function () {
    expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, BigNumber.from("201"))
    ).to.be.revertedWith("Invalid license power");
  });

  it("Add license - user already has one", async function () {
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, BigNumber.from("30"))
    ).to.be.revertedWith("User already has a license");
  });

  it("Add license - power limit reached", async function () {
    const a = await Promise.all(
      (await ethers.getSigners())
        .slice(7, 20)
        .map((signer) =>
          mndContract
            .connect(owner)
            .addLicense(signer.address, ONE_TOKEN.mul("32360679"))
        )
    );

    await expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, ONE_TOKEN.mul("32360679"))
    ).to.be.revertedWith("Max total assigned tokens reached");
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));

    //DO TEST
    await linkNode(mndContract, firstUser, 1);
    let result = await mndContract.ownerOf(1);
    expect(result).to.equal(firstUser.address);
    expect((await mndContract.licenses(1)).nodeAddress).to.equal(NODE_ADDRESS);
    expect(await mndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      true
    );
  });

  it("Link node - address already registered", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(mndContract, firstUser, 1)).to.be.revertedWith(
      "Node address already registered"
    );
  });

  it("Link node - not the owner of the license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(mndContract, secondUser, 1)).to.be.revertedWith(
      "Not the owner of the license"
    );
  });

  it("Link node - wrong license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));

    //DO TEST - try to link with wrong license
    await expect(linkNode(mndContract, firstUser, 2)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));

    //DO TEST - try to link with wrong node address
    await expect(
      mndContract.connect(firstUser).linkNode(1, NULL_ADDRESS)
    ).to.be.revertedWith("Invalid node address");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);

    //DO TEST - try to link before 24 hrs
    await unlinkNode(mndContract, firstUser, 1);
    await expect(linkNode(mndContract, firstUser, 1)).to.be.revertedWith(
      "Cannot reassign within 24 hours"
    );
  });

  it("Link node - link again after 24hrs", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await unlinkNode(mndContract, firstUser, 1);

    //DO TEST - try to link after 24 hrs
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);
    await linkNode(mndContract, firstUser, 1);
  });

  /*it("Calculate rewards", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let result = await mndContract
      .connect(owner)
      .calculateRewards(COMPUTE_PARAMS);
    const formattedResults = result.map((result) => ({
      licenseId: result.licenseId,
      rewardsAmount: result.rewardsAmount,
    }));
    expect(formattedResults[0]).to.deep.equal(EXPECTED_COMPUTE_REWARDS_RESULT);
  });*/

  it("Claim rewards - should work", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await mndContract
      .connect(firstUser)
      .claimRewards(
        COMPUTE_PARAMS,
        Buffer.from(await signComputeParams(oracle), "hex")
      );
    expect(await naeuraContract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - mismatched input arrays length", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 30 * 4]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          COMPUTE_PARAMS,
          Buffer.from(await signComputeParams(oracle), "hex")
        )
    ).to.be.revertedWith("Mismatched input arrays length");
  });

  it("Claim rewards - user does not have the license", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(secondUser)
        .claimRewards(
          COMPUTE_PARAMS,
          Buffer.from(await signComputeParams(oracle), "hex")
        )
    ).to.be.revertedWith("User does not have the license");
  });

  it("Claim rewards - invalid signature", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          COMPUTE_PARAMS,
          Buffer.from(await signComputeParams(firstUser), "hex")
        )
    ).to.be.revertedWith("Invalid signature");
  });

  it("Claim rewards - invalid node address.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.nodeAddress = "0xf2e3878c9ab6a377d331e252f6bf3673d8e87323";
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          COMPUTE_PARAMS,
          Buffer.from(await signComputeParams(oracle), "hex")
        )
    ).to.be.revertedWith("Invalid node address.");
  });

  it("Claim rewards - incorrect number of params.", async function () {
    //SETUP WORLD
    await mndContract
      .connect(owner)
      .addLicense(firstUser.address, BigNumber.from("30"));
    await linkNode(mndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.epochs.concat([6]);
    //DO TEST
    await expect(
      mndContract
        .connect(firstUser)
        .claimRewards(
          COMPUTE_PARAMS,
          Buffer.from(await signComputeParams(oracle), "hex")
        )
    ).to.be.revertedWith("Incorrect number of params.");
  });
});
