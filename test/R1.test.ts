import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Controller, NDContract, R1 } from "../typechain-types";
import {
  deployController,
  deployNDContract,
  deployR1,
  NULL_ADDRESS,
  ONE_TOKEN,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
  revertSnapshotAndCapture,
} from "./helpers";

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

describe("R1 contract", function () {
  /*
    .##......##..#######..########..##.......########......######...########.##....##.########.########.....###....########.####..#######..##....##
    .##..##..##.##.....##.##.....##.##.......##.....##....##....##..##.......###...##.##.......##.....##...##.##......##.....##..##.....##.###...##
    .##..##..##.##.....##.##.....##.##.......##.....##....##........##.......####..##.##.......##.....##..##...##.....##.....##..##.....##.####..##
    .##..##..##.##.....##.########..##.......##.....##....##...####.######...##.##.##.######...########..##.....##....##.....##..##.....##.##.##.##
    .##..##..##.##.....##.##...##...##.......##.....##....##....##..##.......##..####.##.......##...##...#########....##.....##..##.....##.##..####
    .##..##..##.##.....##.##....##..##.......##.....##....##....##..##.......##...###.##.......##....##..##.....##....##.....##..##.....##.##...###
    ..###..###...#######..##.....##.########.########......######...########.##....##.########.##.....##.##.....##....##....####..#######..##....##
    */

  let ndContract: NDContract;
  let r1Contract: R1;
  let controllerContract: Controller;
  let owner: HardhatEthersSigner;
  let firstUser: HardhatEthersSigner;
  let secondUser: HardhatEthersSigner;
  let backend: HardhatEthersSigner;
  let snapshotId: string;

  before(async function () {
    const [deployer, user1, user2, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    backend = backendSigner;

    r1Contract = await deployR1(owner);
    controllerContract = await deployController({
      owner,
      oracleSigners: [backend],
    });
    ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    snapshotId = await takeSnapshot();
  });
  afterEach(async function () {
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  /*
	.########.########..######..########..######.
	....##....##.......##....##....##....##....##
	....##....##.......##..........##....##......
	....##....######....######.....##.....######.
	....##....##.............##....##..........##
	....##....##.......##....##....##....##....##
	....##....########..######.....##.....######.
	*/

  it("Set NDcontract- should work", async function () {
    await r1Contract.setNdContract(ndContract.getAddress());
  });

  it("Set NDcontract- already set", async function () {
    await r1Contract.setNdContract(ndContract.getAddress());
    await expect(
      r1Contract.setNdContract(ndContract.getAddress())
    ).to.be.revertedWith("Node Deed address already set");
  });

  it("Set NDcontract- wrong address", async function () {
    await expect(r1Contract.setNdContract(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid Node Deed address"
    );
  });

  it("Set NDcontract- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).setNdContract(NULL_ADDRESS)
    ).to.be.revertedWithCustomError(r1Contract, "OwnableUnauthorizedAccount");
  });

  it("Set MNDcontract- should work", async function () {
    await r1Contract.setMndContract(ndContract.getAddress());
  });

  it("Set MNDcontract- already set", async function () {
    await r1Contract.setMndContract(ndContract.getAddress());
    await expect(
      r1Contract.setMndContract(ndContract.getAddress())
    ).to.be.revertedWith("Master Node Deed address already set");
  });

  it("Set MNDcontract- wrong address", async function () {
    await expect(r1Contract.setMndContract(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid Master Node Deed address"
    );
  });

  it("Set MNDcontract- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).setMndContract(NULL_ADDRESS)
    ).to.be.revertedWithCustomError(r1Contract, "OwnableUnauthorizedAccount");
  });

  it("Mint- should work", async function () {
    await r1Contract.setNdContract(owner.getAddress());
    await r1Contract
      .connect(owner)
      .mint(firstUser.getAddress(), ONE_TOKEN * 100n);
    expect(await r1Contract.balanceOf(firstUser.getAddress())).to.equal(
      ONE_TOKEN * 100n
    );
  });

  it("Mint- not allowed minter", async function () {
    await expect(
      r1Contract.connect(owner).mint(firstUser.getAddress(), ONE_TOKEN * 100n)
    ).to.be.revertedWith("Only allowed contracts can mint");
  });

  it("Burn- should work", async function () {
    await r1Contract.setNdContract(owner.getAddress());
    await r1Contract
      .connect(owner)
      .mint(firstUser.getAddress(), ONE_TOKEN * 100n);
    await r1Contract
      .connect(owner)
      .burn(firstUser.getAddress(), ONE_TOKEN * 50n);
    expect(await r1Contract.balanceOf(firstUser.getAddress())).to.equal(
      ONE_TOKEN * 50n
    );
  });

  it("burn- not allowed burner", async function () {
    await expect(
      r1Contract.connect(owner).burn(firstUser.getAddress(), ONE_TOKEN * 100n)
    ).to.be.revertedWith("Only allowed contracts can burn");
  });

  it("Add burner- should work", async function () {
    await expect(r1Contract.addBurner(owner.getAddress())).not.to.be.reverted;
  });

  it("Add burner- invalid burner address", async function () {
    await expect(r1Contract.addBurner(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid burner address"
    );
  });

  it("Add burner- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).addBurner(owner.getAddress())
    ).to.be.revertedWithCustomError(r1Contract, "OwnableUnauthorizedAccount");
  });

  it("Remove burner- should work", async function () {
    await expect(r1Contract.addBurner(owner.getAddress())).not.to.be.reverted;
    await expect(r1Contract.removeBurner(owner.getAddress())).not.to.be
      .reverted;
  });

  it("Remove burner- Address is not a burner", async function () {
    await expect(r1Contract.addBurner(owner.getAddress())).not.to.be.reverted;
    await expect(
      r1Contract.removeBurner(firstUser.getAddress())
    ).to.be.revertedWith("Address is not a burner");
  });

  it("Remove burner- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).removeBurner(owner.getAddress())
    ).to.be.revertedWithCustomError(r1Contract, "OwnableUnauthorizedAccount");
  });
});
