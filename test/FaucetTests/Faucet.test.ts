import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { R1, TestnetFaucet } from "../../typechain-types";
const BigNumber = ethers.BigNumber;

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
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let backend: SignerWithAddress;
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
      r1Contract.address,
      BigNumber.from(10).pow(18), // 10 token
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
    await r1Contract
      .connect(owner)
      .mint(faucet.address, BigNumber.from(10).pow(18));
    await faucet.connect(firstUser).claim();
  });

  it("Claim - cool down not passed", async function () {
    await r1Contract
      .connect(owner)
      .mint(faucet.address, BigNumber.from(20).pow(18));
    await faucet.connect(firstUser).claim();
    await expect(faucet.connect(firstUser).claim()).to.be.revertedWith(
      "Faucet: You must wait for the cooldown period to claim again"
    );
  });

  it("Claim - not enough token", async function () {
    await r1Contract
      .connect(owner)
      .mint(faucet.address, BigNumber.from(1).pow(18));
    await expect(faucet.connect(firstUser).claim()).to.be.revertedWith(
      "ERC20InsufficientBalance"
    );
  });

  it("Change settings - should work", async function () {
    await faucet.changeSettings(
      r1Contract.address,
      BigNumber.from(1).pow(18), // 10 token
      864000
    );
  });

  it("Change settings - not the owner", async function () {
    await expect(
      faucet.connect(backend).changeSettings(
        r1Contract.address,
        BigNumber.from(1).pow(18), // 10 token
        864000
      )
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("withdraw - should work", async function () {
    let amount = BigNumber.from(1).pow(18);
    await r1Contract.connect(owner).mint(faucet.address, amount);
    await faucet.connect(owner).withdraw(r1Contract.address);
    expect(await r1Contract.balanceOf(owner.address)).to.be.equal(amount);
  });

  it("withdraw - not the owner", async function () {
    await expect(
      faucet.connect(backend).withdraw(r1Contract.address)
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("get next claim timestamp  - should work", async function () {
    let amount = BigNumber.from(10).pow(18);
    await r1Contract.connect(owner).mint(faucet.address, amount);
    await faucet.connect(firstUser).claim();
    let result = await faucet.getNextClaimTimestamp(firstUser.address);
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const currentTimestamp = block.timestamp;

    expect(result).to.be.equal(
      currentTimestamp + 86400 // 1 day later
    );
  });
});
