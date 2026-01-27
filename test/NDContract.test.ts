import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  buyLicenseWithMintAndAllowance as buyLicenseWithMintAndAllowanceHelper,
  deployController,
  deployMNDContract,
  deployNDContract,
  deployR1,
  deployUniswapMocks,
  NODE_ADDRESS,
  NULL_ADDRESS,
  ONE_DAY_IN_SECS,
  ONE_TOKEN,
  revertSnapshotAndCapture,
  setTimestampAndMine,
  signBuyLicense,
  signComputeParams,
  signLinkNode,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
} from "./helpers";
import { Controller, NDContract, R1 } from "../typechain-types";
import { v4 as uuidv4 } from "uuid";
import { BigNumberish } from "ethers";

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

const newCompanyWallet = "0x0000000000000000000000000000000000000009";
const newVatWallet = "0x0000000000000000000000000000000000000009";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const REWARDS_AMOUNT = 3260194774041496137n;
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: 1n,
  rewardsAmount: REWARDS_AMOUNT,
};
const EXPECTED_LICENSES_INFO = [
  {
    licenseId: 1n,
    nodeAddress: NODE_ADDRESS,
    totalClaimedAmount: 0n,
    remainingAmount: 1575188843457943925233n,
    lastClaimEpoch: 0n,
    claimableEpochs: 2n,
    assignTimestamp: 1738767604n,
  },
];
const EPOCH_IN_A_DAY = 1;

const EXPECTED_PRICE_TIERS = [
  {
    usdPrice: 500n,
    totalUnits: 89n,
    soldUnits: 0n,
  },
  {
    usdPrice: 750n,
    totalUnits: 144n,
    soldUnits: 0n,
  },
  {
    usdPrice: 1000n,
    totalUnits: 233n,
    soldUnits: 0n,
  },
  {
    usdPrice: 1500n,
    totalUnits: 377n,
    soldUnits: 0n,
  },
  {
    usdPrice: 2000n,
    totalUnits: 610n,
    soldUnits: 0n,
  },
  {
    usdPrice: 2500n,
    totalUnits: 987n,
    soldUnits: 0n,
  },
  {
    usdPrice: 3000n,
    totalUnits: 1597n,
    soldUnits: 0n,
  },
  {
    usdPrice: 3500n,
    totalUnits: 2584n,
    soldUnits: 0n,
  },
  {
    usdPrice: 4000n,
    totalUnits: 4181n,
    soldUnits: 0n,
  },
  {
    usdPrice: 5000n,
    totalUnits: 6765n,
    soldUnits: 0n,
  },
  {
    usdPrice: 7000n,
    totalUnits: 10946n,
    soldUnits: 0n,
  },
  {
    usdPrice: 9500n,
    totalUnits: 17711n,
    soldUnits: 0n,
  },
];

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

  let ndContract: NDContract;
  let controllerContract: Controller;
  let r1Contract: R1;
  let owner: HardhatEthersSigner;
  let firstUser: HardhatEthersSigner;
  let secondUser: HardhatEthersSigner;
  let backend: HardhatEthersSigner;
  let maxUnits: number;
  let COMPUTE_PARAMS = {
    licenseId: 1,
    nodeAddress: NODE_ADDRESS,
    epochs: [0, 1, 2, 3, 4],
    availabilies: [250, 130, 178, 12, 0],
  };
  let snapshotId: string;
  let invoiceUuid: Buffer;

  before(async function () {
    const [deployer, user1, user2, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    backend = backendSigner;
    invoiceUuid = Buffer.from("d18ac3989ae74da398c8ab26de41bb7c");

    maxUnits = 100;

    r1Contract = await deployR1(owner);
    const BurnContractFactory = await ethers.getContractFactory("BurnContract");
    const burnContract = await BurnContractFactory.deploy(
      await r1Contract.getAddress()
    );
    await burnContract.waitForDeployment();
    await r1Contract.addBurner(await burnContract.getAddress());
    controllerContract = await deployController({
      owner,
      oracleSigners: [backend],
    });
    ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    await ndContract.connect(owner).setDirectAddLpPercentage(50n);

    const mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await ndContract.setMNDContract(await mndContract.getAddress());

    const {
      usdc: usdcContract,
      router: uniswapMockRouterContract,
      pair: uniswapMockPairContract,
    } = await deployUniswapMocks(r1Contract);

    await ndContract.setUniswapParams(
      await uniswapMockRouterContract.getAddress(),
      await uniswapMockPairContract.getAddress(),
      await usdcContract.getAddress()
    );
    await ndContract.setCompanyWallets(
      newCompanyWallet,
      newLpWallet,
      newVatWallet
    );
    await usdcContract.mint(
      await uniswapMockRouterContract.getAddress(),
      50000000000000000000000n
    );

    await r1Contract.setNdContract(await ndContract.getAddress());
    await r1Contract.setMndContract(await owner.getAddress());

    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrowImplementation = await CspEscrow.deploy();
    await cspEscrowImplementation.waitForDeployment();

    const PoAIManager = await ethers.getContractFactory("PoAIManager");
    const poaiManager = await upgrades.deployProxy(
      PoAIManager,
      [
        await cspEscrowImplementation.getAddress(),
        await ndContract.getAddress(),
        await mndContract.getAddress(),
        await controllerContract.getAddress(),
        await usdcContract.getAddress(),
        await r1Contract.getAddress(),
        await burnContract.getAddress(),
        await uniswapMockRouterContract.getAddress(),
        await uniswapMockPairContract.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.waitForDeployment();
    await ndContract.setPoAIManager(await poaiManager.getAddress());

    snapshotId = await takeSnapshot();
  });
  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    await setTimestampAndMine(START_EPOCH_TIMESTAMP);
  });

  afterEach(async function () {
    COMPUTE_PARAMS = {
      licenseId: 1,
      nodeAddress: NODE_ADDRESS,
      epochs: [0, 1, 2, 3, 4],
      availabilies: [250, 130, 178, 12, 0],
    };
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  async function buyLicenseWithMintAndAllowance(
    r1: R1,
    nd: NDContract,
    mintAuthority: HardhatEthersSigner,
    buyer: HardhatEthersSigner,
    pricePerLicense: bigint,
    licenseCount: number,
    priceTier: number,
    usdMintLimit: number,
    vatPercent: number,
    signature: string
  ) {
    return buyLicenseWithMintAndAllowanceHelper({
      r1,
      nd,
      mintAuthority,
      buyer,
      pricePerLicense,
      licenseCount,
      priceTier,
      invoiceUuid,
      usdMintLimit,
      vatPercent,
      signature,
    });
  }

  async function linkNode(
    ndContract: NDContract,
    user: HardhatEthersSigner,
    licenseId: number
  ) {
    await ndContract
      .connect(user)
      .linkNode(
        licenseId,
        NODE_ADDRESS,
        await signLinkNode(backend, user, NODE_ADDRESS)
      );
  }

  async function unlinkNode(
    ndContract: NDContract,
    user: HardhatEthersSigner,
    licenseId: number
  ) {
    await ndContract.connect(user).unlinkNode(licenseId);
  }

  async function createLicenseSignature(
    signer: HardhatEthersSigner,
    user: HardhatEthersSigner,
    usdMintLimit: BigNumberish,
    vatPercent: number = 20
  ) {
    return signBuyLicense(
      signer,
      await user.getAddress(),
      invoiceUuid,
      usdMintLimit,
      vatPercent
    );
  }

  const computeSignatureHex = (signer: HardhatEthersSigner) =>
    signComputeParams({
      signer,
      nodeAddress: COMPUTE_PARAMS.nodeAddress,
      epochs: COMPUTE_PARAMS.epochs,
      availabilities: COMPUTE_PARAMS.availabilies,
    });

  const computeSignatureBytes = (signer: HardhatEthersSigner) =>
    computeSignatureHex(signer).then((signature) => ethers.getBytes(signature));

  async function updateTimestamp() {
    await setTimestampAndMine(
      START_EPOCH_TIMESTAMP + (ONE_DAY_IN_SECS * 2) / EPOCH_IN_A_DAY
    );
  }

  type LicenseInfoOutput =
    Awaited<ReturnType<NDContract["getLicenses"]>>[number];
  type PriceTierOutput =
    Awaited<ReturnType<NDContract["getPriceTiers"]>>[number];
  type RewardsResultOutput =
    Awaited<ReturnType<NDContract["calculateRewards"]>>[number];

  function formatLicenseInfo(license: LicenseInfoOutput) {
    return {
      licenseId: license.licenseId,
      nodeAddress: license.nodeAddress,
      totalClaimedAmount: license.totalClaimedAmount,
      remainingAmount: license.remainingAmount,
      lastClaimEpoch: license.lastClaimEpoch,
      claimableEpochs: license.claimableEpochs,
      assignTimestamp: license.assignTimestamp,
    };
  }

  function formatPriceTier(tier: PriceTierOutput) {
    return {
      usdPrice: tier.usdPrice,
      totalUnits: tier.totalUnits,
      soldUnits: tier.soldUnits,
    };
  }

  function formatRewardsResult(result: RewardsResultOutput) {
    return {
      licenseId: result.licenseId,
      rewardsAmount: result.rewardsAmount,
    };
  }

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

  it("Supports interface - should work", async function () {
    //ERC721
    expect(await ndContract.supportsInterface("0x80ac58cd")).to.be.true;
  });

  it("Get licenses", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await updateTimestamp();

    let result = await ndContract.getLicenses(await firstUser.getAddress());
    expect(EXPECTED_LICENSES_INFO).to.deep.equal(
      result.map(formatLicenseInfo)
    );
  });

  it("Get licenses - user has no license", async function () {
    let result = await ndContract.getLicenses(await firstUser.getAddress());
    expect([]).to.deep.equal(
      result.map(formatLicenseInfo)
    );
  });

  it("Set base uri- should work", async function () {
    let baseUri = "PIPPO.com/";
    await ndContract.setBaseURI(baseUri);
  });

  it("Set base uri - not the owner", async function () {
    let baseUri = "PIPPO.com/";
    await expect(
      ndContract.connect(firstUser).setBaseURI(baseUri)
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Get Token Price - should work", async function () {
    expect(await ndContract.getTokenPrice()).to.equal(300000300000300000n);
  });

  it("Set Max Allowed Price Difference - should work", async function () {
    await expect(ndContract.setMaxAllowedPriceDifference(1000n)).not.to.be
      .reverted;
  });

  it("Set Max Allowed Price Difference - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).setMaxAllowedPriceDifference(1000n)
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Set Max Allowed Price Difference - paused contract", async function () {
    await ndContract.connect(owner).pause();
    await expect(ndContract.setMaxAllowedPriceDifference(1000n)).not.to.be
      .reverted;
  });

  it("Burn - should work", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await expect(ndContract.connect(firstUser).burn(1)).not.to.be.reverted;
  });

  it("Burn - not the owner", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await expect(ndContract.connect(secondUser).burn(1))
      .to.be.revertedWithCustomError(ndContract, "NotLicenseOwner");
  });

  it("Burn - paused contract", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await ndContract.connect(owner).pause();
    await expect(
      ndContract.connect(secondUser).burn(1)
    ).to.be.revertedWithCustomError(ndContract, "EnforcedPause");
  });

  it("Get token uri", async function () {
    let baseUri = "PIPPO.com/";
    await ndContract.setBaseURI(baseUri);

    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    let result = await ndContract.tokenURI(1n);
    expect(baseUri).to.equal(result);
  });

  it("Get price tiers", async function () {
    let result = await ndContract.getPriceTiers();
    expect(EXPECTED_PRICE_TIERS).to.deep.equal(
      result.map(formatPriceTier)
    );
  });

  it("Buy license - should work", async function () {
    let price = await ndContract.getLicensePriceInUSD();
    expect(price).to.equal(500);
    let licenseTokenPrice = await ndContract.getLicenseTokenPrice();
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    expect(await firstUser.getAddress()).to.equal(await ndContract.ownerOf(1));
    let newLpWalletAmount = await r1Contract.balanceOf(newLpWallet);
    expect("100").to.deep.equal(newLpWalletAmount);
  });

  it("Buy license - Price exceeds max accepted", async function () {
    const licenseTokenPrice = await ndContract.getLicenseTokenPrice();
    const pricePerLicense = licenseTokenPrice / 2n;
    const totalWithoutVat = pricePerLicense;
    const vatAmount = (totalWithoutVat * 20n) / 100n;
    const totalWithVat = totalWithoutVat + vatAmount;
    const maxAcceptedTokenPerLicense = totalWithVat + totalWithVat / 10n;
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        pricePerLicense,
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    )
      .to.be.revertedWithCustomError(ndContract, "PriceExceedsMaxAccepted")
      .withArgs(licenseTokenPrice, maxAcceptedTokenPerLicense);
  });

  it("Buy license - Price exceeds max accepted", async function () {
    const licenseTokenPrice = await ndContract.getLicenseTokenPrice();
    const maxAcceptedTokenPerLicense = 2n;
    //Mint tokens
    await r1Contract
      .connect(owner)
      .mint(await firstUser.getAddress(), licenseTokenPrice);

    //Buy license without giving allowance
    await expect(
      ndContract
        .connect(firstUser)
        .buyLicense(
          1,
          1,
          maxAcceptedTokenPerLicense,
          invoiceUuid,
          10000,
          20,
          ethers.getBytes(
            await createLicenseSignature(backend, firstUser, 10000)
          )
        )
    )
      .to.be.revertedWithCustomError(ndContract, "PriceExceedsMaxAccepted")
      .withArgs(licenseTokenPrice, maxAcceptedTokenPerLicense);
  });

  it("Buy license - paused contract", async function () {
    //SETUP WORLD
    await ndContract.connect(owner).pause();

    //DO TEST - try to buy license
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).to.be.revertedWithCustomError(ndContract, "EnforcedPause");
  });

  it("Buy license - wrong signature", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(secondUser, firstUser, 10000)
      )
    ).to.be.revertedWith("Invalid oracle signature");
  });

  it("Buy license- wrong tier", async function () {
    const currentPriceTier = await ndContract.currentPriceTier();
    const requestedPriceTier = 2n;
    //DO TEST -try buy 1 license in first tier
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        Number(requestedPriceTier),
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    )
      .to.be.revertedWithCustomError(ndContract, "WrongPriceTier")
      .withArgs(currentPriceTier, requestedPriceTier);
  });

  it("Buy license- wrong number of licenses", async function () {
    //DO TEST -try buy 1 license in first tier
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        maxUnits + 1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).to.be.revertedWithCustomError(ndContract, "ExceedsMintLimit");
  });

  it("Buy license- Invoice UUID has already been used", async function () {
    //DO TEST
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).not.to.be.reverted;
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).to.be.revertedWithCustomError(ndContract, "InvoiceUuidUsed");
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    expect(await ndContract.isNodeActive(NODE_ADDRESS)).to.be.false;

    //DO TEST
    await linkNode(ndContract, firstUser, 1);
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(await firstUser.getAddress());
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NODE_ADDRESS);
    expect(await ndContract.registeredNodeAddresses(NODE_ADDRESS)).to.be.true;
    expect(await ndContract.isNodeActive(NODE_ADDRESS)).to.be.true;
  });

  it("Link node - address already registered", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(ndContract, firstUser, 1))
      .to.be.revertedWithCustomError(ndContract, "NodeAddressAlreadyRegistered");
  });

  it("Link node - not the owner of the license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(ndContract, secondUser, 1))
      .to.be.revertedWithCustomError(ndContract, "NotLicenseOwner");
  });

  it("Link node - wrong license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    //DO TEST - try to link with wrong license
    await expect(
      linkNode(ndContract, firstUser, 2)
    ).to.be.revertedWithCustomError(ndContract, "ERC721NonexistentToken");
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    //DO TEST - try to link with wrong node address
    await expect(
      ndContract
        .connect(firstUser)
        .linkNode(
          1,
          NULL_ADDRESS,
          await signLinkNode(backend, firstUser, NULL_ADDRESS)
        )
    ).to.be.revertedWithCustomError(ndContract, "InvalidNodeAddress");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link before 24 hrs
    await unlinkNode(ndContract, firstUser, 1);
    await expect(linkNode(ndContract, firstUser, 1))
      .to.be.revertedWithCustomError(ndContract, "CannotReassignWithin24Hours");
  });

  it("Link node - link again after 24hrs", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await unlinkNode(ndContract, firstUser, 1);

    //DO TEST - try to link after 24 hrs
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS]);
    await ethers.provider.send("evm_mine", []);
    await linkNode(ndContract, firstUser, 1);
  });

  it("Unlink node", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST
    await unlinkNode(ndContract, firstUser, 1);
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
    expect(await ndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      false
    );
  });

  it("Transfer - empty license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    //DO TEST - transfer empty license
    await ndContract
      .connect(firstUser)
      .transferFrom(
        await firstUser.getAddress(),
        await secondUser.getAddress(),
        1
      );
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(await secondUser.getAddress());
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Transfer - linked license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - transfer linked license
    await ndContract
      .connect(firstUser)
      .transferFrom(
        await firstUser.getAddress(),
        await secondUser.getAddress(),
        1
      );
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(await secondUser.getAddress());
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Calculate rewards", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let result = await ndContract
      .connect(owner)
      .calculateRewards([COMPUTE_PARAMS]);
    const formattedResults = result.map(formatRewardsResult);
    expect(formattedResults[0]).to.deep.equal(EXPECTED_COMPUTE_REWARDS_RESULT);
  });

  it("Claim rewards - should work", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT + userPreviousBalance
    );
  });

  it("Claim rewards with real oracle data", async function () {
    //SETUP WORLD
    await controllerContract.addOracle(
      "0x93B04EF1152D81A0847C2272860a8a5C70280E14"
    );
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS / EPOCH_IN_A_DAY,
    ]);
    const nodeAddress = "0x1351504af17BFdb80491D9223d6Bcb6BB964DCeD";
    await ndContract
      .connect(firstUser)
      .linkNode(
        1,
        nodeAddress,
        await signLinkNode(backend, firstUser, nodeAddress)
      );
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract.connect(firstUser).claimRewards(
      [
        {
          licenseId: 1,
          nodeAddress,
          epochs: [1, 2, 3, 4, 5],
          availabilies: [0, 0, 0, 0, 0],
        },
      ],
      [
        [
          "0xc17b67684afb68fe25fb7ba6ec7fdf08c4d5fc8970ab03a7b3659a20d5df620314cb35b90deddff9cbc13668cc964e13816be73f308402e9903dae422106ca5d1c",
        ],
      ]
    );
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      userPreviousBalance
    );
  });

  it("Claim rewards - mismatched input arrays length", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS, COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "MismatchedInputArraysLength");
  });

  it("Claim rewards - user does not have the license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(secondUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "NotLicenseOwner");
  });

  it("Claim rewards - invalid signature", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(secondUser)]]
        )
    ).to.be.revertedWith("Invalid oracle signature");
  });

  it("Claim rewards - duplicate signature", async function () {
    //SETUP WORLD
    await controllerContract.setMinimumRequiredSignatures(2);
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [
            [
              await computeSignatureBytes(backend),
              await computeSignatureBytes(backend),
            ],
          ]
        )
    ).to.be.revertedWith("Duplicate oracle signature");
  });

  it("Claim rewards - double signature", async function () {
    //SETUP WORLD
    await controllerContract.setMinimumRequiredSignatures(2);
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await controllerContract.addOracle(await secondUser.getAddress());
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [
          [
            await computeSignatureBytes(backend),
            await computeSignatureBytes(secondUser),
          ],
        ]
      );
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT + userPreviousBalance
    );
  });

  it("Claim rewards - wrong number signature", async function () {
    //SETUP WORLD
    await controllerContract.setMinimumRequiredSignatures(2);
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWith("Insufficient signatures");
  });

  it("Claim rewards - invalid node address.", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.nodeAddress = "0xf2e3878c9ab6a377d331e252f6bf3673d8e87323";
    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "InvalidNodeAddressForRewards");
  });

  it("Claim rewards - incorrect number of params.", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    COMPUTE_PARAMS.epochs = [1, 2, 3, 4, 5, 6, 7, 8];
    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "IncorrectNumberOfParams");
  });

  it("Claim rewards - 0 epoch to claim", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT + userPreviousBalance
    );
    //should not modify amount
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT + userPreviousBalance
    );
  });

  it("Claim rewards - max release per license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 366 * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < 366 * 5; i++) {
      COMPUTE_PARAMS.epochs[i] = i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    let expected_result = 1575188843457943925233n;
    //DO TEST
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      expected_result + userPreviousBalance
    );

    COMPUTE_PARAMS.epochs = [1830];
    COMPUTE_PARAMS.availabilies = [255];

    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 366 * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      expected_result + userPreviousBalance //should not be changed
    );
  });

  it("Claim rewards - full history claim with 5 oracles", async function () {
    //SETUP WORLD
    let [oracle1, oracle2, oracle3, oracle4, oracle5] = (
      await ethers.getSigners()
    ).slice(15, 20);
    await controllerContract.addOracle(await oracle1.getAddress());
    await controllerContract.addOracle(await oracle2.getAddress());
    await controllerContract.addOracle(await oracle3.getAddress());
    await controllerContract.addOracle(await oracle4.getAddress());
    await controllerContract.addOracle(await oracle5.getAddress());
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 36 * 30]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < 36 * 30; i++) {
      COMPUTE_PARAMS.epochs[i] = i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    let expected_result = 1575188843457943924200n;
    //DO TEST
    let userPreviousBalance = await r1Contract.balanceOf(
      await firstUser.getAddress()
    );
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [
          [
            await computeSignatureBytes(oracle1),
            await computeSignatureBytes(oracle2),
            await computeSignatureBytes(oracle3),
            await computeSignatureBytes(oracle4),
            await computeSignatureBytes(oracle5),
          ],
        ]
      );
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      expected_result + userPreviousBalance
    );
  });

  it("Add signer - should work", async function () {
    //ADD second user as a signer
    await controllerContract.addOracle(await secondUser.getAddress());

    //Should not be reverted
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(secondUser, firstUser, 10000) //second user is a signer
    );
  });

  it("Pause contract - should work", async function () {
    await ndContract.connect(owner).pause();
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).to.be.revertedWithCustomError(ndContract, "EnforcedPause");
  });

  it("Pause contract - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).pause()
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Unpause contract - should work", async function () {
    await ndContract.connect(owner).pause();
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        1,
        10000,
        20,
        await createLicenseSignature(backend, firstUser, 10000)
      )
    ).to.be.revertedWithCustomError(ndContract, "EnforcedPause");

    await ndContract.connect(owner).unpause();

    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
  });

  it("Unpause contract - not the owner", async function () {
    await ndContract.connect(owner).pause();
    await expect(
      ndContract.connect(firstUser).unpause()
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Ban license - should work", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    await ndContract.connect(owner).banLicense(1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "LicenseBanned");
  });

  it("Ban license - already banned", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );

    await ndContract.connect(owner).banLicense(1);
    await expect(ndContract.connect(owner).banLicense(1))
      .to.be.revertedWithCustomError(ndContract, "LicenseAlreadyBanned");
  });

  it("Ban license - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).banLicense(1)
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Unban license - should work", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await createLicenseSignature(backend, firstUser, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ndContract.connect(owner).banLicense(1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await expect(
      ndContract
        .connect(firstUser)
        .claimRewards(
          [COMPUTE_PARAMS],
          [[await computeSignatureBytes(backend)]]
        )
    ).to.be.revertedWithCustomError(ndContract, "LicenseBanned");
    await ndContract.connect(owner).unbanLicense(1);
    await ndContract
      .connect(firstUser)
      .claimRewards([COMPUTE_PARAMS], [[await computeSignatureBytes(backend)]]);
  });

  it("Unban license - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).unbanLicense(1)
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Unban license - not banned license", async function () {
    await expect(ndContract.connect(owner).unbanLicense(1))
      .to.be.revertedWithCustomError(ndContract, "LicenseNotBanned");
  });

  it.skip("Buy all license ", async function () {
    //DO TEST
    for (let i = 1; i <= 12; i++) {
      expect(await ndContract.currentPriceTier()).to.equal(i);
      let tier = await ndContract._priceTiers(i);
      let units = Number(tier.totalUnits);
      do {
        const uuidHex = uuidv4().replace(/-/g, "");
        const uuidBuffer = Buffer.from(uuidHex);
        const signature = await signBuyLicense(
          backend,
          await firstUser.getAddress(),
          uuidBuffer,
          1_000_000,
          20
        );

        if (units > maxUnits) {
          await buyLicenseWithMintAndAllowance(
            r1Contract,
            ndContract,
            owner,
            firstUser,
            (await ndContract.getLicenseTokenPrice()) * BigInt(maxUnits),
            maxUnits,
            i,
            1_000_000,
            20,
            signature
          );
          units -= maxUnits;
        } else {
          await buyLicenseWithMintAndAllowance(
            r1Contract,
            ndContract,
            owner,
            firstUser,
            (await ndContract.getLicenseTokenPrice()) * BigInt(units),
            units,
            i,
            1_000_000,
            20,
            signature
          );
          units -= units;
        }
      } while (units > 0);
    }

    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        (await ndContract.getLicenseTokenPrice()) * 1000n,
        1,
        12,
        1_000_000,
        20,
        await createLicenseSignature(backend, firstUser, 1_000_000)
      )
    ).to.be.revertedWithCustomError(ndContract, "AllLicensesSold");
  });
});
