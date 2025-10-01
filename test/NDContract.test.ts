import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { R1, NDContract, Controller } from "../typechain-types";
import { v4 as uuidv4 } from "uuid";

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

const ONE_TOKEN = 10n ** 18n;
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const newCompanyWallet = "0x0000000000000000000000000000000000000009";
const newVatWallet = "0x0000000000000000000000000000000000000009";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const REWARDS_AMOUNT = 3260194774041496137n;
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: 1n,
  rewardsAmount: REWARDS_AMOUNT,
};
const START_EPOCH_TIMESTAMP = 1738767600;
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

    const R1Contract = await ethers.getContractFactory("R1");
    r1Contract = await R1Contract.deploy(await owner.getAddress());

    const USDCContract = await ethers.getContractFactory("ERC20Mock");
    let usdcContract = await USDCContract.deploy();

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      await owner.getAddress()
    );
    await controllerContract.addOracle(await backend.getAddress());

    const NDContractFactory = await ethers.getContractFactory("NDContract");
    ndContract = (await upgrades.deployProxy(
      NDContractFactory,
      [
        await r1Contract.getAddress(),
        await controllerContract.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    )) as NDContract;

    let LpPercentage = 50n;
    await ndContract.connect(owner).setDirectAddLpPercentage(LpPercentage);

    const MNDContractFactory = await ethers.getContractFactory("MNDContract");
    const mndContract = await upgrades.deployProxy(
      MNDContractFactory,
      [
        await r1Contract.getAddress(),
        await controllerContract.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );

    await ndContract.setMNDContract(await mndContract.getAddress());

    const UniswapMockRouterContract = await ethers.getContractFactory(
      "UniswapMockRouter"
    );
    const uniswapMockRouterContract = await UniswapMockRouterContract.deploy();

    const UniswapMockPairContract = await ethers.getContractFactory(
      "UniswapMockPair"
    );
    const uniswapMockPairContract = await UniswapMockPairContract.deploy(
      await usdcContract.getAddress(),
      await r1Contract.getAddress()
    );

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
        await uniswapMockRouterContract.getAddress(),
        await uniswapMockPairContract.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.waitForDeployment();
    await ndContract.setPoAIManager(await poaiManager.getAddress());

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });
  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    let daysToAdd = START_EPOCH_TIMESTAMP;
    await ethers.provider.send("evm_setNextBlockTimestamp", [daysToAdd]);
    await ethers.provider.send("evm_mine", []);
  });

  afterEach(async function () {
    COMPUTE_PARAMS = {
      licenseId: 1,
      nodeAddress: NODE_ADDRESS,
      epochs: [0, 1, 2, 3, 4],
      availabilies: [250, 130, 178, 12, 0],
    };
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  /*
  .##.....##.########.####.##........######.
  .##.....##....##.....##..##.......##....##
  .##.....##....##.....##..##.......##......
  .##.....##....##.....##..##........######.
  .##.....##....##.....##..##.............##
  .##.....##....##.....##..##.......##....##
  ..#######.....##....####.########..######.
  */

  async function buyLicenseWithMintAndAllowance(
    r1Contract: R1,
    ndContract: NDContract,
    owner: HardhatEthersSigner,
    user: HardhatEthersSigner,
    numTokens: bigint,
    numLicenses: number,
    priceTier: number,
    usdMintLimit: number,
    vatPercent: number,
    signature: string
  ) {
    let _NUM_TOKENS =
      numTokens + (numTokens * BigInt(vatPercent)) / BigInt(100);
    let _MAX_ACCEPTED_NUM_TOKENS = _NUM_TOKENS + _NUM_TOKENS / 10n;
    _MAX_ACCEPTED_NUM_TOKENS = _MAX_ACCEPTED_NUM_TOKENS * BigInt(numLicenses);
    await r1Contract
      .connect(owner)
      .mint(await user.getAddress(), _MAX_ACCEPTED_NUM_TOKENS);
    await r1Contract
      .connect(user)
      .approve(await ndContract.getAddress(), _MAX_ACCEPTED_NUM_TOKENS);
    await ndContract
      .connect(user)
      .buyLicense(
        numLicenses,
        priceTier,
        _MAX_ACCEPTED_NUM_TOKENS,
        invoiceUuid,
        usdMintLimit,
        vatPercent,
        Buffer.from(signature, "hex")
      );
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

  async function signAddress(
    signer: HardhatEthersSigner,
    user: HardhatEthersSigner,
    invoiceUuid: Buffer,
    usdMintLimit: number,
    vatPercent: number = 20
  ) {
    const addressBytes = Buffer.from((await user.getAddress()).slice(2), "hex");

    let messageBytes = Buffer.concat([addressBytes, invoiceUuid]);
    const buffer = ethers.zeroPadValue(ethers.toBeHex(usdMintLimit), 32);
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(buffer.slice(2), "hex"),
    ]);
    const bufferVatPercentage = ethers.zeroPadValue(
      ethers.toBeHex(vatPercent),
      32
    );
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(bufferVatPercentage.slice(2), "hex"),
    ]);
    const messageHash = ethers.keccak256(messageBytes);
    const signature = await signer.signMessage(ethers.getBytes(messageHash));

    let signatureBytes = Buffer.from(signature.slice(2), "hex");
    if (signatureBytes[64] < 27) {
      signatureBytes[64] += 27;
    }

    return signatureBytes.toString("hex");
  }

  async function signLinkNode(
    signer: HardhatEthersSigner,
    user: HardhatEthersSigner,
    nodeAddress: string
  ) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "address"],
      [await user.getAddress(), nodeAddress]
    );
    return signer.signMessage(ethers.getBytes(messageHash));
  }

  async function signComputeParams(signer: HardhatEthersSigner) {
    let messageBytes = Buffer.from(COMPUTE_PARAMS.nodeAddress.slice(2), "hex");

    for (const epoch of COMPUTE_PARAMS.epochs) {
      const epochBytes = ethers.zeroPadValue(ethers.toBeArray(epoch), 32);
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(epochBytes.slice(2), "hex"),
      ]);
    }

    for (const availability of COMPUTE_PARAMS.availabilies) {
      const availabilityBytes = ethers.zeroPadValue(
        ethers.toBeArray(availability),
        32
      );
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(availabilityBytes.slice(2), "hex"),
      ]);
    }

    const messageHash = ethers.keccak256(messageBytes);
    let signature = await signer.signMessage(ethers.getBytes(messageHash));
    let signatureBytes = Buffer.from(signature.slice(2), "hex");
    if (signatureBytes[64] < 27) {
      signatureBytes[64] += 27;
    }

    return signatureBytes.toString("hex");
  }

  async function updateTimestamp() {
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      START_EPOCH_TIMESTAMP + (ONE_DAY_IN_SECS * 2) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);
  }

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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await updateTimestamp();

    let result = await ndContract.getLicenses(await firstUser.getAddress());
    expect(EXPECTED_LICENSES_INFO).to.deep.equal(
      result.map((r) => {
        return {
          licenseId: r.licenseId,
          nodeAddress: r.nodeAddress,
          totalClaimedAmount: r.totalClaimedAmount,
          remainingAmount: r.remainingAmount,
          lastClaimEpoch: r.lastClaimEpoch,
          claimableEpochs: r.claimableEpochs,
          assignTimestamp: r.assignTimestamp,
        };
      })
    );
  });

  it("Get licenses - user has no license", async function () {
    let result = await ndContract.getLicenses(await firstUser.getAddress());
    expect([]).to.deep.equal(
      result.map((r) => {
        return {
          licenseId: r.licenseId,
          nodeAddress: r.nodeAddress,
          totalClaimedAmount: r.totalClaimedAmount,
          remainingAmount: r.remainingAmount,
          lastClaimEpoch: r.lastClaimEpoch,
          claimableEpochs: r.claimableEpochs,
          assignTimestamp: r.assignTimestamp,
        };
      })
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await expect(ndContract.connect(secondUser).burn(1)).to.be.revertedWith(
      "Not the owner of the license"
    );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    let result = await ndContract.tokenURI(1n);
    expect(baseUri).to.equal(result);
  });

  it("Get price tiers", async function () {
    let result = await ndContract.getPriceTiers();
    expect(EXPECTED_PRICE_TIERS).to.deep.equal(
      result.map((r) => {
        return {
          usdPrice: r.usdPrice,
          totalUnits: r.totalUnits,
          soldUnits: r.soldUnits,
        };
      })
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    expect(await firstUser.getAddress()).to.equal(await ndContract.ownerOf(1));
    let newLpWalletAmount = await r1Contract.balanceOf(newLpWallet);
    expect("100").to.deep.equal(newLpWalletAmount);
  });

  it("Buy license - Price exceeds max accepted", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        (await ndContract.getLicenseTokenPrice()) / 2n,
        1,
        1,
        10000,
        20,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Price exceeds max accepted");
  });

  it("Buy license - Price exceeds max accepted", async function () {
    //Mint tokens
    await r1Contract
      .connect(owner)
      .mint(
        await firstUser.getAddress(),
        await ndContract.getLicenseTokenPrice()
      );

    //Buy license without giving allowance
    await expect(
      ndContract
        .connect(firstUser)
        .buyLicense(
          1,
          1,
          2,
          invoiceUuid,
          10000,
          20,
          Buffer.from(
            await signAddress(backend, firstUser, invoiceUuid, 10000),
            "hex"
          )
        )
    ).to.be.revertedWith("Price exceeds max accepted");
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
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
        await signAddress(secondUser, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Invalid oracle signature");
  });

  it("Buy license- wrong tier", async function () {
    //DO TEST -try buy 1 license in first tier
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        await ndContract.getLicenseTokenPrice(),
        1,
        2,
        10000,
        20,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Not in the right price tier");
  });

  it("Buy license- wrong number of lienses", async function () {
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Exceeds mint limit");
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Invoice UUID has already been used");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(ndContract, firstUser, 1)).to.be.revertedWith(
      "Node address already registered"
    );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link again
    await expect(linkNode(ndContract, secondUser, 1)).to.be.revertedWith(
      "Not the owner of the license"
    );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
    ).to.be.revertedWith("Invalid node address");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - try to link before 24 hrs
    await unlinkNode(ndContract, firstUser, 1);
    await expect(linkNode(ndContract, firstUser, 1)).to.be.revertedWith(
      "Cannot reassign within 24 hours"
    );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
    const formattedResults = result.map((result) => ({
      licenseId: result.licenseId,
      rewardsAmount: result.rewardsAmount,
    }));
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("Mismatched input arrays length");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("User does not have the license");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(secondUser), "hex")]]
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
              Buffer.from(await signComputeParams(backend), "hex"),
              Buffer.from(await signComputeParams(backend), "hex"),
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
            Buffer.from(await signComputeParams(backend), "hex"),
            Buffer.from(await signComputeParams(secondUser), "hex"),
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("Invalid node address.");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("Incorrect number of params.");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await r1Contract.balanceOf(await firstUser.getAddress())).to.equal(
      REWARDS_AMOUNT + userPreviousBalance
    );
    //should not modify amount
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
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
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
            Buffer.from(await signComputeParams(oracle1), "hex"),
            Buffer.from(await signComputeParams(oracle2), "hex"),
            Buffer.from(await signComputeParams(oracle3), "hex"),
            Buffer.from(await signComputeParams(oracle4), "hex"),
            Buffer.from(await signComputeParams(oracle5), "hex"),
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
      await signAddress(secondUser, firstUser, invoiceUuid, 10000) //second user is a signer
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
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
        await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("License is banned, cannot perform action");
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    await ndContract.connect(owner).banLicense(1);
    await expect(ndContract.connect(owner).banLicense(1)).to.be.revertedWith(
      "License is already banned"
    );
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
      await signAddress(backend, firstUser, invoiceUuid, 10000)
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
          [[Buffer.from(await signComputeParams(backend), "hex")]]
        )
    ).to.be.revertedWith("License is banned, cannot perform action");
    await ndContract.connect(owner).unbanLicense(1);
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
  });

  it("Unban license - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).unbanLicense(1)
    ).to.be.revertedWithCustomError(ndContract, "OwnableUnauthorizedAccount");
  });

  it("Unban license - not banned license", async function () {
    await expect(ndContract.connect(owner).unbanLicense(1)).to.be.revertedWith(
      "License is not banned"
    );
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
        let signature = await signAddress(
          backend,
          firstUser,
          uuidBuffer,
          1_000_000
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
        await signAddress(backend, firstUser, invoiceUuid, 1_000_000)
      )
    ).to.be.revertedWith("All licenses have been sold");
  });
});
