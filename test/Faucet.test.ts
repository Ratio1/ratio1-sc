import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { R1, TestnetFaucet } from "../typechain-types";

describe("Faucet contract", function () {
  /*
    .##......##..#######..########..##.......########......######...########.##....##.########.########.....###....########.####..#######..##....##
    .##..##..##.##.....##.##.....##.##.......##.....##....##....##..##.......###...##.##.......##.....##...##.##......##.....##..##.....##.###...##
    .##..##..##.##.....##.##.....##.##.......##.....##....##........##.......####..##.##.......##.....##..##...##.....##.....##..##.....##.####..##
    .##..##..##.##.....##.########..##.......##.....##....##...####.######...##.##.##.######...########..##.....##....##.....##..##.....##.##.##.##
    .##..##..##.##.....##.##...##...##.......##.....##....##....##..##.......##..####.##.......##...##...#########....##.....##..##.....##.##..####
    .##..##..##.##.....##.##....##..##.......##.....##....##....##..##.......##...###.##.......##....##..##.....##....##.....##..##.....##.##...###
    ..###..###...#######..##.....##.########.########......######...########.##....##.########.##.....##.##.....##....##....####..#######..##....##
    */

  let faucet: TestnetFaucet;
  let r1Contract: R1;
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

    const R1Contract = await ethers.getContractFactory("R1");
    r1Contract = await R1Contract.deploy(owner.address);

    await r1Contract.setNdContract(owner.address);

    const FaucetContract = await ethers.getContractFactory("TestnetFaucet");
    faucet = await FaucetContract.deploy(
      await r1Contract.getAddress(),
      10n ** 18n, // 10 token
      86400
    );
    //await ndContract.setUniswapRouter(uniswapContract.address);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });
  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
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

  it("Claim - should work", async function () {
    await r1Contract.connect(owner).mint(faucet.getAddress(), 10n ** 18n);
    await faucet.connect(firstUser).claim();
  });

  it("Claim - cool down not passed", async function () {
    await r1Contract.connect(owner).mint(faucet.getAddress(), 20n ** 18n);
    await faucet.connect(firstUser).claim();
    await expect(faucet.connect(firstUser).claim()).to.be.revertedWith(
      "Faucet: You must wait for the cooldown period to claim again"
    );
  });

  it("Claim - not enough token", async function () {
    await r1Contract.connect(owner).mint(faucet.getAddress(), 1n ** 18n);
    await expect(
      faucet.connect(firstUser).claim()
    ).to.be.revertedWithCustomError(r1Contract, "ERC20InsufficientBalance");
  });

  it("Change settings - should work", async function () {
    await faucet.changeSettings(
      r1Contract.getAddress(),
      1n ** 18n, // 10 token
      864000
    );
  });

  it("Change settings - not the owner", async function () {
    await expect(
      faucet.connect(backend).changeSettings(
        r1Contract.getAddress(),
        1n ** 18n, // 10 token
        864000
      )
    ).to.be.revertedWithCustomError(faucet, "OwnableUnauthorizedAccount");
  });

  it("withdraw - should work", async function () {
    let amount = 1n ** 18n;
    await r1Contract.connect(owner).mint(faucet.getAddress(), amount);
    await faucet.connect(owner).withdraw(r1Contract.getAddress());
    expect(await r1Contract.balanceOf(owner.address)).to.be.equal(amount);
  });

  it("withdraw - not the owner", async function () {
    await expect(
      faucet.connect(backend).withdraw(r1Contract.getAddress())
    ).to.be.revertedWithCustomError(faucet, "OwnableUnauthorizedAccount");
  });

  it("get next claim timestamp  - should work", async function () {
    let amount = 10n ** 18n;
    await r1Contract.connect(owner).mint(faucet.getAddress(), amount);
    await faucet.connect(firstUser).claim();
    let result = await faucet.getNextClaimTimestamp(firstUser.address);
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const currentTimestamp = block?.timestamp || 0;

    expect(result).to.be.equal(
      currentTimestamp + 86400 // 1 day later
    );
  });
});
