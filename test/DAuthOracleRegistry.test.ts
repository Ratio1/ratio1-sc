import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Controller, DAuthOracleRegistry } from "../typechain-types";
import { deployController, NULL_ADDRESS } from "./helpers";

describe("DAuthOracleRegistry contract", function () {
  let controller: Controller;
  let registry: DAuthOracleRegistry;
  let owner: HardhatEthersSigner;
  let firstOracle: HardhatEthersSigner;
  let secondOracle: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  async function deployRegistry(): Promise<DAuthOracleRegistry> {
    const RegistryContract = await ethers.getContractFactory(
      "DAuthOracleRegistry"
    );
    const contract = (await RegistryContract.deploy(
      await controller.getAddress(),
      owner.address
    )) as unknown as DAuthOracleRegistry;
    await contract.waitForDeployment();
    return contract;
  }

  beforeEach(async function () {
    [owner, firstOracle, secondOracle, nonOracle] = await ethers.getSigners();

    controller = await deployController({
      owner,
      oracleSigners: [firstOracle, secondOracle],
    });
    registry = await deployRegistry();
  });

  it("constructor - should set controller and owner", async function () {
    expect(await registry.controller()).to.equal(await controller.getAddress());
    expect(await registry.owner()).to.equal(owner.address);
  });

  it("constructor - invalid controller address", async function () {
    const RegistryContract = await ethers.getContractFactory(
      "DAuthOracleRegistry"
    );

    await expect(
      RegistryContract.deploy(NULL_ADDRESS, owner.address)
    ).to.be.revertedWith("Invalid controller address");
  });

  it("constructor - invalid owner address", async function () {
    const RegistryContract = await ethers.getContractFactory(
      "DAuthOracleRegistry"
    );

    await expect(
      RegistryContract.deploy(await controller.getAddress(), NULL_ADDRESS)
    ).to.be.revertedWithCustomError(
      RegistryContract,
      "OwnableInvalidOwner"
    );
  });

  it("add dAuth oracle - should work for Controller oracle", async function () {
    await expect(registry.addDAuthOracle(firstOracle.address))
      .to.emit(registry, "DAuthOracleAdded")
      .withArgs(firstOracle.address);

    expect(await registry.isDAuthOracle(firstOracle.address)).to.equal(true);
    expect(await registry.getDAuthOracles()).to.deep.equal([
      firstOracle.address,
    ]);
  });

  it("add dAuth oracle - invalid dAuth oracle address", async function () {
    await expect(registry.addDAuthOracle(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid dAuth oracle address"
    );
  });

  it("add dAuth oracle - dAuth oracle already exists", async function () {
    await registry.addDAuthOracle(firstOracle.address);

    await expect(
      registry.addDAuthOracle(firstOracle.address)
    ).to.be.revertedWith("dAuth oracle already exists");
  });

  it("add dAuth oracle - address is not Controller oracle", async function () {
    await expect(
      registry.addDAuthOracle(nonOracle.address)
    ).to.be.revertedWith("Address is not Controller oracle");
  });

  it("add dAuth oracle - removed Controller oracle is rejected", async function () {
    await controller.removeOracle(firstOracle.address);

    await expect(
      registry.addDAuthOracle(firstOracle.address)
    ).to.be.revertedWith("Address is not Controller oracle");
  });

  it("add dAuth oracle - not the owner", async function () {
    await expect(
      registry.connect(firstOracle).addDAuthOracle(firstOracle.address)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("remove dAuth oracle - should work", async function () {
    await registry.addDAuthOracle(firstOracle.address);
    await registry.addDAuthOracle(secondOracle.address);

    await expect(registry.removeDAuthOracle(firstOracle.address))
      .to.emit(registry, "DAuthOracleRemoved")
      .withArgs(firstOracle.address);

    expect(await registry.isDAuthOracle(firstOracle.address)).to.equal(false);
    expect(await registry.isDAuthOracle(secondOracle.address)).to.equal(true);
    expect(await registry.getDAuthOracles()).to.deep.equal([
      secondOracle.address,
    ]);
  });

  it("remove dAuth oracle - should work for last oracle", async function () {
    await registry.addDAuthOracle(firstOracle.address);

    await expect(registry.removeDAuthOracle(firstOracle.address))
      .to.emit(registry, "DAuthOracleRemoved")
      .withArgs(firstOracle.address);

    expect(await registry.isDAuthOracle(firstOracle.address)).to.equal(false);
    expect(await registry.getDAuthOracles()).to.deep.equal([]);
  });

  it("remove dAuth oracle - should remove stale Controller oracle", async function () {
    await registry.addDAuthOracle(firstOracle.address);
    await controller.removeOracle(firstOracle.address);

    expect(await registry.isDAuthOracle(firstOracle.address)).to.equal(false);
    expect(await registry.getDAuthOracles()).to.deep.equal([]);

    await expect(registry.removeDAuthOracle(firstOracle.address))
      .to.emit(registry, "DAuthOracleRemoved")
      .withArgs(firstOracle.address);

    expect(await registry.getDAuthOracles()).to.deep.equal([]);
  });

  it("remove dAuth oracle - dAuth oracle does not exist", async function () {
    await expect(
      registry.removeDAuthOracle(nonOracle.address)
    ).to.be.revertedWith("dAuth oracle does not exist");
  });

  it("remove dAuth oracle - not the owner", async function () {
    await expect(
      registry.connect(firstOracle).removeDAuthOracle(firstOracle.address)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });

  it("get dAuth oracles - should return all dAuth oracles", async function () {
    await registry.addDAuthOracle(firstOracle.address);
    await registry.addDAuthOracle(secondOracle.address);

    expect(await registry.getDAuthOracles()).to.deep.equal([
      firstOracle.address,
      secondOracle.address,
    ]);
  });

  it("get dAuth oracles - excludes dAuth oracles removed from Controller", async function () {
    await registry.addDAuthOracle(firstOracle.address);
    await registry.addDAuthOracle(secondOracle.address);
    await controller.removeOracle(firstOracle.address);

    expect(await registry.isDAuthOracle(firstOracle.address)).to.equal(false);
    expect(await registry.isDAuthOracle(secondOracle.address)).to.equal(true);
    expect(await registry.getDAuthOracles()).to.deep.equal([
      secondOracle.address,
    ]);
  });
});
