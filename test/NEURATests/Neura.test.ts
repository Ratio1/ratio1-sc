import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { NAEURA, NDContract } from "../../typechain-types";
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

describe("NEURA contract", function () {
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
  let naeuraContract: NAEURA;
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let backend: SignerWithAddress;
  let maxUnits: number;

  beforeEach(async function () {
    const [deployer, user1, user2, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    backend = backendSigner;

    maxUnits = 5; //TODO change with storage when updated (with maxUnits = 100 it could take up to 95s)

    const NAEURAContract = await ethers.getContractFactory("NAEURA");
    naeuraContract = await NAEURAContract.deploy();

    const NDContract = await ethers.getContractFactory("NDContract");
    ndContract = await NDContract.deploy(
      naeuraContract.address,
      backend.address
    );

    const UniswapContract = await ethers.getContractFactory("UNISWAP");
    const uniswapContract = await UniswapContract.deploy();

    await ndContract.setUniswapRouter(uniswapContract.address);
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
    await naeuraContract.setNdContract(ndContract.address);
  });

  it("Set NDcontract- already set", async function () {
    await naeuraContract.setNdContract(ndContract.address);
    await expect(
      naeuraContract.setNdContract(ndContract.address)
    ).to.be.revertedWith("Node Deed address already set");
  });

  it("Set NDcontract- wrong address", async function () {
    await expect(naeuraContract.setNdContract(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid Node Deed address"
    );
  });

  it("Set NDcontract- should work", async function () {
    await naeuraContract.setMndContract(ndContract.address);
  });

  it("Set NDcontract- already set", async function () {
    await naeuraContract.setMndContract(ndContract.address);
    await expect(
      naeuraContract.setMndContract(ndContract.address)
    ).to.be.revertedWith("Master Node Deed address already set");
  });

  it("Set NDcontract- wrong address", async function () {
    await expect(
      naeuraContract.setMndContract(NULL_ADDRESS)
    ).to.be.revertedWith("Invalid Master Node Deed address");
  });

  it("Mint- should work", async function () {
    await naeuraContract.setNdContract(owner.address);
    await naeuraContract
      .connect(owner)
      .mint(firstUser.address, ONE_TOKEN.mul(100));
    expect(await naeuraContract.balanceOf(firstUser.address)).to.equal(
      ONE_TOKEN.mul(100)
    );
  });

  it("Mint- not allowed minter", async function () {
    await expect(
      naeuraContract.connect(owner).mint(firstUser.address, ONE_TOKEN.mul(100))
    ).to.be.revertedWith("Only allowed contracts can mint");
  });

  it("Burn- should work", async function () {
    await naeuraContract.setNdContract(owner.address);
    await naeuraContract
      .connect(owner)
      .mint(firstUser.address, ONE_TOKEN.mul(100));
    await naeuraContract
      .connect(owner)
      .burn(firstUser.address, ONE_TOKEN.mul(50));
    expect(await naeuraContract.balanceOf(firstUser.address)).to.equal(
      ONE_TOKEN.mul(50)
    );
  });

  it("burn- not allowed minter", async function () {
    await expect(
      naeuraContract.connect(owner).burn(firstUser.address, ONE_TOKEN.mul(100))
    ).to.be.revertedWith("Only allowed contracts can burn");
  });
});
