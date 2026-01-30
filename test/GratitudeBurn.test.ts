import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BurnContract, GratitudeBurn, R1 } from "../typechain-types";
import {
  deployR1,
  NULL_ADDRESS,
  ONE_TOKEN,
  revertSnapshotAndCapture,
  takeSnapshot,
} from "./helpers";

describe("GratitudeBurn", function () {
  let r1: R1;
  let burnContract: BurnContract;
  let gratitudeBurn: GratitudeBurn;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let snapshotId: string;

  async function deployGratitudeBurn(): Promise<GratitudeBurn> {
    const factory = await ethers.getContractFactory("GratitudeBurn");
    const hub = (await upgrades.deployProxy(
      factory,
      [await r1.getAddress(), await burnContract.getAddress()],
      { initializer: "initialize" }
    )) as GratitudeBurn;
    await hub.waitForDeployment();
    return hub;
  }

  async function registerApp(name: string, slug: string): Promise<string> {
    const appId = await gratitudeBurn.registerApp.staticCall(name, slug);
    await gratitudeBurn.registerApp(name, slug);
    return appId;
  }

  async function mintAndApprove(
    user: HardhatEthersSigner,
    amount: bigint
  ): Promise<void> {
    await r1.mint(await user.getAddress(), amount);
    await r1.connect(user).approve(await gratitudeBurn.getAddress(), amount);
  }

  before(async function () {
    const [deployer, firstUser, secondUser, thirdUser] =
      await ethers.getSigners();
    owner = deployer;
    user1 = firstUser;
    user2 = secondUser;
    user3 = thirdUser;

    r1 = await deployR1(owner);
    await r1.setNdContract(await owner.getAddress());

    const burnFactory = await ethers.getContractFactory("BurnContract");
    burnContract = (await burnFactory.deploy(
      await r1.getAddress()
    )) as BurnContract;
    await burnContract.waitForDeployment();
    await r1.addBurner(await burnContract.getAddress());

    gratitudeBurn = await deployGratitudeBurn();

    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  it("registerApp returns appId, stores metadata, emits event, and increments count", async function () {
    const name = "Test App";
    const slug = "test-app";
    const expectedAppId = ethers.keccak256(ethers.toUtf8Bytes(slug));

    const returnedAppId = await gratitudeBurn.registerApp.staticCall(name, slug);
    expect(returnedAppId).to.equal(expectedAppId);

    await expect(gratitudeBurn.registerApp(name, slug))
      .to.emit(gratitudeBurn, "AppRegistered")
      .withArgs(expectedAppId, name, slug, await owner.getAddress());

    const [storedName, storedSlug, exists] = await gratitudeBurn.getApp(
      expectedAppId
    );
    expect(storedName).to.equal(name);
    expect(storedSlug).to.equal(slug);
    expect(exists).to.equal(true);

    expect(await gratitudeBurn.getAppCount()).to.equal(1);
    expect(await gratitudeBurn.getAppIdAt(0)).to.equal(expectedAppId);
  });

  it("registerApp rejects invalid slug and duplicate appId", async function () {
    await expect(
      gratitudeBurn.registerApp("Bad", "")
    ).to.be.revertedWithCustomError(gratitudeBurn, "InvalidSlug");

    const longSlug = "a".repeat(33);
    await expect(
      gratitudeBurn.registerApp("TooLong", longSlug)
    ).to.be.revertedWithCustomError(gratitudeBurn, "InvalidSlug");

    await gratitudeBurn.registerApp("App", "dup-slug");
    await expect(
      gratitudeBurn.registerApp("App2", "dup-slug")
    ).to.be.revertedWithCustomError(gratitudeBurn, "AppAlreadyExists");
  });

  it("burn reverts if app is not registered", async function () {
    const appId = ethers.keccak256(ethers.toUtf8Bytes("missing-app"));
    await mintAndApprove(user1, ONE_TOKEN);

    await expect(
      gratitudeBurn.connect(user1).burn(ONE_TOKEN, appId)
    ).to.be.revertedWithCustomError(gratitudeBurn, "AppNotRegistered");
  });

  it("burn transfers, delegates to burnerContract, and records totals", async function () {
    const appId = await registerApp("Burnable", "burnable");
    const amount = ONE_TOKEN * 3n;
    await mintAndApprove(user1, amount);

    await expect(gratitudeBurn.connect(user1).burn(amount, appId))
      .to.emit(gratitudeBurn, "BurnRecorded")
      .withArgs(user1.address, appId, amount, amount, amount);

    expect(await r1.balanceOf(user1.address)).to.equal(0);
    expect(await r1.balanceOf(await gratitudeBurn.getAddress())).to.equal(0);

    expect(await gratitudeBurn.getUserTotal(user1.address)).to.equal(amount);
    expect(await gratitudeBurn.getAppTotal(appId)).to.equal(amount);
    expect(await gratitudeBurn.getUniqueBurnersCount()).to.equal(1);
  });

  it("totals and uniqueBurnersCount update correctly across multiple burns", async function () {
    const appId = await registerApp("Totals", "totals");
    await mintAndApprove(user1, ONE_TOKEN * 5n);
    await mintAndApprove(user2, ONE_TOKEN * 4n);

    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 2n, appId);
    expect(await gratitudeBurn.getUserTotal(user1.address)).to.equal(
      ONE_TOKEN * 2n
    );
    expect(await gratitudeBurn.getUniqueBurnersCount()).to.equal(1);

    await gratitudeBurn.connect(user1).burn(ONE_TOKEN, appId);
    expect(await gratitudeBurn.getUserTotal(user1.address)).to.equal(
      ONE_TOKEN * 3n
    );
    expect(await gratitudeBurn.getUniqueBurnersCount()).to.equal(1);

    await gratitudeBurn.connect(user2).burn(ONE_TOKEN * 4n, appId);
    expect(await gratitudeBurn.getUserTotal(user2.address)).to.equal(
      ONE_TOKEN * 4n
    );
    expect(await gratitudeBurn.getAppTotal(appId)).to.equal(ONE_TOKEN * 7n);
    expect(await gratitudeBurn.getUniqueBurnersCount()).to.equal(2);
  });

  it("top burners inserts, updates, and bubbles up", async function () {
    const appId = await registerApp("Leaderboard", "leaderboard");

    await mintAndApprove(user1, ONE_TOKEN * 10n);
    await mintAndApprove(user2, ONE_TOKEN * 10n);
    await mintAndApprove(user3, ONE_TOKEN * 10n);

    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 5n, appId);
    await gratitudeBurn.connect(user2).burn(ONE_TOKEN * 3n, appId);
    await gratitudeBurn.connect(user3).burn(ONE_TOKEN * 4n, appId);

    let [users, totals] = await gratitudeBurn.getTopBurners();
    expect(users[0]).to.equal(user1.address);
    expect(totals[0]).to.equal(ONE_TOKEN * 5n);
    expect(users[1]).to.equal(user3.address);
    expect(totals[1]).to.equal(ONE_TOKEN * 4n);
    expect(users[2]).to.equal(user2.address);
    expect(totals[2]).to.equal(ONE_TOKEN * 3n);
    expect(users[3]).to.equal(NULL_ADDRESS);

    await gratitudeBurn.connect(user2).burn(ONE_TOKEN * 3n, appId);

    [users, totals] = await gratitudeBurn.getTopBurners();
    expect(users[0]).to.equal(user2.address);
    expect(totals[0]).to.equal(ONE_TOKEN * 6n);
    expect(users[1]).to.equal(user1.address);
    expect(totals[1]).to.equal(ONE_TOKEN * 5n);
    expect(users[2]).to.equal(user3.address);
    expect(totals[2]).to.equal(ONE_TOKEN * 4n);
  });

  it("top burners evicts when full", async function () {
    const appId = await registerApp("Evict", "evict");
    const signers = await ethers.getSigners();
    const capacity = Number(await gratitudeBurn.TOP_BURNERS());
    expect(signers.length).to.be.gte(capacity);

    for (let i = 0; i < capacity; i++) {
      const signer = signers[i];
      const amount = ONE_TOKEN * BigInt(i + 1);
      await r1.mint(signer.address, amount);
      await r1.connect(signer).approve(await gratitudeBurn.getAddress(), amount);
      await gratitudeBurn.connect(signer).burn(amount, appId);
    }

    const extraWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({
      to: extraWallet.address,
      value: ethers.parseEther("1"),
    });
    const extraAmount = ONE_TOKEN * 2n;
    await r1.mint(extraWallet.address, extraAmount);
    await r1
      .connect(extraWallet)
      .approve(await gratitudeBurn.getAddress(), extraAmount);
    await gratitudeBurn.connect(extraWallet).burn(extraAmount, appId);

    const [users] = await gratitudeBurn.getTopBurners();
    expect(users).to.include(extraWallet.address);
    expect(users).to.not.include(signers[0].address);
  });

  it("top apps ordering updates and bubbles up", async function () {
    const appA = await registerApp("App A", "app-a");
    const appB = await registerApp("App B", "app-b");
    const appC = await registerApp("App C", "app-c");
    await mintAndApprove(user1, ONE_TOKEN * 20n);

    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 5n, appA);
    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 3n, appB);
    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 4n, appC);

    let [apps, totals] = await gratitudeBurn.getTopApps();
    expect(apps[0]).to.equal(appA);
    expect(totals[0]).to.equal(ONE_TOKEN * 5n);
    expect(apps[1]).to.equal(appC);
    expect(totals[1]).to.equal(ONE_TOKEN * 4n);
    expect(apps[2]).to.equal(appB);
    expect(totals[2]).to.equal(ONE_TOKEN * 3n);

    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 3n, appB);

    [apps, totals] = await gratitudeBurn.getTopApps();
    expect(apps[0]).to.equal(appB);
    expect(totals[0]).to.equal(ONE_TOKEN * 6n);
    expect(apps[1]).to.equal(appA);
    expect(totals[1]).to.equal(ONE_TOKEN * 5n);
    expect(apps[2]).to.equal(appC);
    expect(totals[2]).to.equal(ONE_TOKEN * 4n);
  });

  it("top apps evicts when full", async function () {
    const capacity = Number(await gratitudeBurn.TOP_APPS());
    const appIds: string[] = [];
    for (let i = 0; i < capacity; i++) {
      const appId = await registerApp(`App ${i}`, `app-${i}`);
      appIds.push(appId);
    }

    const totalAmount = ONE_TOKEN * BigInt((capacity * (capacity + 1)) / 2 + 2);
    await mintAndApprove(user1, totalAmount);

    for (let i = 0; i < capacity; i++) {
      const amount = ONE_TOKEN * BigInt(i + 1);
      await gratitudeBurn.connect(user1).burn(amount, appIds[i]);
    }

    const extraAppId = await registerApp("Extra App", "extra-app");
    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 2n, extraAppId);

    const [apps] = await gratitudeBurn.getTopApps();
    expect(apps).to.include(extraAppId);
    expect(apps).to.not.include(appIds[0]);
  });

  it("edge cases: amount zero and multiple apps per user", async function () {
    const appA = await registerApp("Edge A", "edge-a");
    const appB = await registerApp("Edge B", "edge-b");

    await expect(
      gratitudeBurn.connect(user1).burn(0, appA)
    ).to.be.revertedWithCustomError(gratitudeBurn, "InvalidAmount");

    await mintAndApprove(user1, ONE_TOKEN * 5n);
    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 2n, appA);
    await gratitudeBurn.connect(user1).burn(ONE_TOKEN * 3n, appB);

    expect(await gratitudeBurn.getUserTotal(user1.address)).to.equal(
      ONE_TOKEN * 5n
    );
    expect(await gratitudeBurn.getAppTotal(appA)).to.equal(ONE_TOKEN * 2n);
    expect(await gratitudeBurn.getAppTotal(appB)).to.equal(ONE_TOKEN * 3n);
    expect(await gratitudeBurn.getUniqueBurnersCount()).to.equal(1);
  });
});
