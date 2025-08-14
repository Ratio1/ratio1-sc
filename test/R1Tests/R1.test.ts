import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { R1, NDContract, Controller } from "../../typechain-types";
const BigNumber = ethers.BigNumber;

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_TOKEN = BigNumber.from(10).pow(18);
const START_EPOCH_TIMESTAMP = 1738767600;

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

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      owner.address
    );
    await controllerContract.addOracle(backend.address);

    const NDContractFactory = await ethers.getContractFactory("NDContract");
    ndContract = (await upgrades.deployProxy(
      NDContractFactory,
      [r1Contract.address, controllerContract.address, owner.address],
      { initializer: "initialize" }
    )) as NDContract;

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

  it("Set NDcontract- should work", async function () {
    await r1Contract.setNdContract(ndContract.address);
  });

  it("Set NDcontract- already set", async function () {
    await r1Contract.setNdContract(ndContract.address);
    await expect(
      r1Contract.setNdContract(ndContract.address)
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
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Set MNDcontract- should work", async function () {
    await r1Contract.setMndContract(ndContract.address);
  });

  it("Set MNDcontract- already set", async function () {
    await r1Contract.setMndContract(ndContract.address);
    await expect(
      r1Contract.setMndContract(ndContract.address)
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
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Mint- should work", async function () {
    await r1Contract.setNdContract(owner.address);
    await r1Contract.connect(owner).mint(firstUser.address, ONE_TOKEN.mul(100));
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      ONE_TOKEN.mul(100)
    );
  });

  it("Mint- not allowed minter", async function () {
    await expect(
      r1Contract.connect(owner).mint(firstUser.address, ONE_TOKEN.mul(100))
    ).to.be.revertedWith("Only allowed contracts can mint");
  });

  it("Burn- should work", async function () {
    await r1Contract.setNdContract(owner.address);
    await r1Contract.connect(owner).mint(firstUser.address, ONE_TOKEN.mul(100));
    await r1Contract.connect(owner).burn(firstUser.address, ONE_TOKEN.mul(50));
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      ONE_TOKEN.mul(50)
    );
  });

  it("burn- not allowed burner", async function () {
    await expect(
      r1Contract.connect(owner).burn(firstUser.address, ONE_TOKEN.mul(100))
    ).to.be.revertedWith("Only allowed contracts can burn");
  });

  it("Add burner- should work", async function () {
    await expect(r1Contract.addBurner(owner.address)).not.to.be.reverted;
  });

  it("Add burner- invalid burner address", async function () {
    await expect(r1Contract.addBurner(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid burner address"
    );
  });

  it("Add burner- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).addBurner(owner.address)
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });

  it("Remove burner- should work", async function () {
    await expect(r1Contract.addBurner(owner.address)).not.to.be.reverted;
    await expect(r1Contract.removeBurner(owner.address)).not.to.be.reverted;
  });

  it("Remove burner- Address is not a burner", async function () {
    await expect(r1Contract.addBurner(owner.address)).not.to.be.reverted;
    await expect(r1Contract.removeBurner(firstUser.address)).to.be.revertedWith(
      "Address is not a burner"
    );
  });

  it("Remove burner- not the owner", async function () {
    await expect(
      r1Contract.connect(firstUser).removeBurner(owner.address)
    ).to.be.revertedWith("OwnableUnauthorizedAccount");
  });
});
