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

describe("NDContract", function () {
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

  it.only("Add license - power limit reached", async function () {
    const a = await Promise.all(
      (await ethers.getSigners())
        .slice(10, 23)
        .map((signer) =>
          mndContract
            .connect(owner)
            .addLicense(signer.address, BigNumber.from("200"))
        )
    );

    expect(
      mndContract
        .connect(owner)
        .addLicense(firstUser.address, BigNumber.from("20"))
    ).to.be.revertedWith("Max supply reached");
  });
});
