import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployMNDContract,
  deployNDContract,
  deployR1,
  NODE_ADDRESS,
  NULL_ADDRESS,
  setTimestampAndMine,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
  revertSnapshotAndCapture,
} from "./helpers";
import { Controller } from "../typechain-types";

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

describe("Controller contract", function () {
  /*
    .##......##..#######..########..##.......########......######...########.##....##.########.########.....###....########.####..#######..##....##
    .##..##..##.##.....##.##.....##.##.......##.....##....##....##..##.......###...##.##.......##.....##...##.##......##.....##..##.....##.###...##
    .##..##..##.##.....##.##.....##.##.......##.....##....##........##.......####..##.##.......##.....##..##...##.....##.....##..##.....##.####..##
    .##..##..##.##.....##.########..##.......##.....##....##...####.######...##.##.##.######...########..##.....##....##.....##..##.....##.##.##.##
    .##..##..##.##.....##.##...##...##.......##.....##....##....##..##.......##..####.##.......##...##...#########....##.....##..##.....##.##..####
    .##..##..##.##.....##.##....##..##.......##.....##....##....##..##.......##...###.##.......##....##..##.....##....##.....##..##.....##.##...###
    ..###..###...#######..##.....##.########.########......######...########.##....##.########.##.....##.##.....##....##....####..#######..##....##
    */

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

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      owner.address
    );
    await controllerContract.addOracle(backend.address);
    snapshotId = await takeSnapshot();
  });

  async function setContracts() {
    const r1Contract = await deployR1(owner);
    const ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    const mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await controllerContract.setContracts(
      await ndContract.getAddress(),
      await mndContract.getAddress()
    );
  }

  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    await setTimestampAndMine(START_EPOCH_TIMESTAMP);
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

  it("Set minimum required signature - should work", async function () {
    await expect(controllerContract.setMinimumRequiredSignatures(1)).to.not.be
      .reverted;
  });

  it("Set minimum required signature - not the owner", async function () {
    await expect(
      controllerContract.connect(backend).setMinimumRequiredSignatures(1)
    ).to.be.revertedWithCustomError(
      controllerContract,
      "OwnableUnauthorizedAccount"
    );
  });

  it("Empty signatures array should fail", async function () {
    await expect(
      controllerContract.requireVerifySignatures(
        "0x726174696f310000000000000000000000000000000000000000000000000000",
        [],
        false
      )
    ).to.be.reverted;
  });

  it("Set contracts - should work", async function () {
    await setContracts();
  });

  it("Set contracts - not the owner", async function () {
    const r1Contract = await deployR1(owner);
    const ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    const mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await expect(
      controllerContract
        .connect(backend)
        .setContracts(
          await ndContract.getAddress(),
          await mndContract.getAddress()
        )
    ).to.be.reverted;
  });

  it("Set contracts - 0 address", async function () {
    const r1Contract = await deployR1(owner);
    const ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    const mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await expect(
      controllerContract.setContracts(
        NULL_ADDRESS,
        await mndContract.getAddress()
      )
    ).to.be.reverted;
    await expect(
      controllerContract.setContracts(
        await ndContract.getAddress(),
        NULL_ADDRESS
      )
    ).to.be.reverted;
  });

  it("Is node active", async function () {
    await setContracts();
    expect(await controllerContract.isNodeActive(NODE_ADDRESS)).to.be.false;
  });

  it("add oracle - should work", async function () {
    await expect(controllerContract.addOracle(NODE_ADDRESS)).to.not.be.reverted;
  });

  it("add oracle - oracle already exist", async function () {
    await expect(
      controllerContract.addOracle(backend.address)
    ).to.be.revertedWith("Oracle already exists");
  });

  it("add oracle - Invalid oracle address", async function () {
    await expect(controllerContract.addOracle(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid oracle address"
    );
  });

  it("add oracle - not the owner", async function () {
    await expect(
      controllerContract.connect(backend).addOracle(NULL_ADDRESS)
    ).to.be.revertedWithCustomError(
      controllerContract,
      "OwnableUnauthorizedAccount"
    );
  });

  it("remove oracle - should work", async function () {
    await expect(controllerContract.removeOracle(backend.address)).to.not.be
      .reverted;
  });

  it("remove oracle - oracle does not exist", async function () {
    await expect(
      controllerContract.removeOracle(NODE_ADDRESS)
    ).to.be.revertedWith("Oracle does not exist");
  });

  it("remove oracle - not the owner", async function () {
    await expect(
      controllerContract.connect(backend).removeOracle(NODE_ADDRESS)
    ).to.be.revertedWithCustomError(
      controllerContract,
      "OwnableUnauthorizedAccount"
    );
  });

  it("get oracles - should work", async function () {
    let result = await controllerContract.getOracles();
    expect(result[0]).to.be.equal(backend.address);
  });
});
