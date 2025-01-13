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
});
