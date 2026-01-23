import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BurnContract, R1 } from "../typechain-types";
import {
  deployR1,
  NULL_ADDRESS,
  ONE_TOKEN,
  takeSnapshot,
  revertSnapshotAndCapture,
} from "./helpers";

describe("BurnContract", function () {
  let r1Contract: R1;
  let burnContract: BurnContract;
  let owner: HardhatEthersSigner;
  let firstUser: HardhatEthersSigner;
  let secondUser: HardhatEthersSigner;
  let snapshotId: string;

  before(async function () {
    const [deployer, user1, user2] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;

    r1Contract = await deployR1(owner);
    const factory = await ethers.getContractFactory("BurnContract");
    burnContract = (await factory.deploy(
      await r1Contract.getAddress()
    )) as BurnContract;
    await burnContract.waitForDeployment();

    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  it("constructor- zero address", async function () {
    const factory = await ethers.getContractFactory("BurnContract");
    await expect(factory.deploy(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid R1 Address"
    );
  });

  it("burn- should work for msg.sender only", async function () {
    await r1Contract.setNdContract(owner.getAddress());
    await r1Contract.addBurner(await burnContract.getAddress());
    await r1Contract.mint(firstUser.getAddress(), ONE_TOKEN * 10n);
    await r1Contract.mint(secondUser.getAddress(), ONE_TOKEN * 5n);

    await burnContract.connect(firstUser).burn(ONE_TOKEN * 4n);

    expect(await r1Contract.balanceOf(firstUser.getAddress())).to.equal(
      ONE_TOKEN * 6n
    );
    expect(await r1Contract.balanceOf(secondUser.getAddress())).to.equal(
      ONE_TOKEN * 5n
    );
  });

  it("burn- not allowed burner", async function () {
    await r1Contract.setNdContract(owner.getAddress());
    await r1Contract.mint(firstUser.getAddress(), ONE_TOKEN * 10n);

    await expect(
      burnContract.connect(firstUser).burn(ONE_TOKEN)
    ).to.be.revertedWith("Only allowed contracts can burn");
  });

  it("burn- exceeds balance", async function () {
    await r1Contract.setNdContract(owner.getAddress());
    await r1Contract.addBurner(await burnContract.getAddress());
    await r1Contract.mint(firstUser.getAddress(), ONE_TOKEN);

    await expect(
      burnContract.connect(firstUser).burn(ONE_TOKEN * 2n)
    ).to.be.revertedWithCustomError(r1Contract, "ERC20InsufficientBalance");
  });
});
