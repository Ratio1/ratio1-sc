import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  R1,
  NDContract,
  Controller,
  Reader,
  MNDContract,
  PoAIManager,
} from "../typechain-types";
import { Contract } from "ethers";

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/
const invoiceUuid = Buffer.from("d18ac3989ae74da398c8ab26de41bb7c");
const newCompanyWallet = "0x0000000000000000000000000000000000000009";
const newVatWallet = "0x0000000000000000000000000000000000000009";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const START_EPOCH_TIMESTAMP = 1738767600;
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Reader contract", function () {
  /*
    .##......##..#######..########..##.......########......######...########.##....##.########.########.....###....########.####..#######..##....##
    .##..##..##.##.....##.##.....##.##.......##.....##....##....##..##.......###...##.##.......##.....##...##.##......##.....##..##.....##.###...##
    .##..##..##.##.....##.##.....##.##.......##.....##....##........##.......####..##.##.......##.....##..##...##.....##.....##..##.....##.####..##
    .##..##..##.##.....##.########..##.......##.....##....##...####.######...##.##.##.######...########..##.....##....##.....##..##.....##.##.##.##
    .##..##..##.##.....##.##...##...##.......##.....##....##....##..##.......##..####.##.......##...##...#########....##.....##..##.....##.##..####
    .##..##..##.##.....##.##....##..##.......##.....##....##....##..##.......##...###.##.......##....##..##.....##....##.....##..##.....##.##...###
    ..###..###...#######..##.....##.########.########......######...########.##....##.########.##.....##.##.....##....##....####..#######..##....##
    */
  let reader: Reader;
  let r1Contract: R1;
  let controllerContract: Controller;
  let owner: HardhatEthersSigner;
  let backend: HardhatEthersSigner;
  let snapshotId: string;
  let ndContract: NDContract;
  let mndContract: MNDContract;
  let poaiManager: PoAIManager;
  let firstUser: HardhatEthersSigner;
  let oracle_assignation_timestamp: number;

  before(async function () {
    await network.provider.request({ method: "hardhat_reset", params: [] });

    const [deployer, user1, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    backend = backendSigner;

    const R1Contract = await ethers.getContractFactory("R1");
    r1Contract = await R1Contract.deploy(await owner.getAddress());

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      await owner.getAddress()
    );
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    oracle_assignation_timestamp = block?.timestamp || 0;
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

    const MNDContractFactory = await ethers.getContractFactory("MNDContract");
    mndContract = (await upgrades.deployProxy(
      MNDContractFactory,
      [
        await r1Contract.getAddress(),
        await controllerContract.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    )) as unknown as MNDContract;

    await controllerContract.setContracts(
      await ndContract.getAddress(),
      await mndContract.getAddress()
    );

    await mndContract.setNDContract(await ndContract.getAddress());
    await ndContract.setMNDContract(await mndContract.getAddress());
    await r1Contract.setNdContract(await ndContract.getAddress());
    await r1Contract.setMndContract(await owner.getAddress()); // to mint r1 tokens

    let LpPercentage = 50_00n;
    await ndContract.connect(owner).setDirectAddLpPercentage(LpPercentage);

    const USDCContract = await ethers.getContractFactory("ERC20Mock");
    let usdcContract = await USDCContract.deploy();
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
      await newCompanyWallet,
      await newLpWallet,
      await newVatWallet
    );
    await usdcContract.mint(
      await uniswapMockRouterContract.getAddress(),
      500n * 10n ** 18n
    );

    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrowImplementation = await CspEscrow.deploy();
    await cspEscrowImplementation.waitForDeployment();

    const PoAIManager = await ethers.getContractFactory("PoAIManager");
    poaiManager = await upgrades.deployProxy(
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

    const ReaderContract = await ethers.getContractFactory("Reader");
    reader = await ReaderContract.deploy();

    await reader.initialize(
      await ndContract.getAddress(),
      await mndContract.getAddress(),
      await controllerContract.getAddress(),
      await r1Contract.getAddress(),
      await poaiManager.getAddress()
    );

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    let daysToAdd = START_EPOCH_TIMESTAMP;
    await ethers.provider.send("evm_setNextBlockTimestamp", [daysToAdd]);
    await ethers.provider.send("evm_mine", []);
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

  async function linkNode(
    ndContract: NDContract,
    user: HardhatEthersSigner,
    licenseId: number,
    nodeAddress: string = NODE_ADDRESS
  ) {
    await ndContract
      .connect(user)
      .linkNode(
        licenseId,
        nodeAddress,
        await signLinkNode(backend, user, nodeAddress)
      );
  }

  async function MNDlinkNode(
    mndContract: MNDContract,
    user: HardhatEthersSigner,
    licenseId: number
  ) {
    await mndContract
      .connect(user)
      .linkNode(
        licenseId,
        NODE_ADDRESS,
        await signLinkNode(backend, user, NODE_ADDRESS)
      );
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

  it("Get Nd license - should work", async function () {
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
    await expect(reader.getNdLicenseDetails(1)).to.not.be.reverted;
  });

  it("Get Nd license - non existent license", async function () {
    await expect(reader.getNdLicenseDetails(1)).to.be.revertedWithCustomError(
      ndContract,
      "ERC721NonexistentToken"
    );
  });

  it("Get MNd license - should work", async function () {
    await expect(reader.getMndLicenseDetails(1)).to.not.be.reverted;
  });

  it("Get MNd license - non existent license", async function () {
    await expect(reader.getMndLicenseDetails(2)).to.be.revertedWithCustomError(
      mndContract,
      "ERC721NonexistentToken"
    );
  });

  it("Get Node license - no license", async function () {
    let result = await reader.getNodeLicenseDetails(NODE_ADDRESS);
    const mapped = {
      licenseType: result[0],
      licenseId: result[1],
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4],
      totalClaimedAmount: result[5],
      lastClaimEpoch: result[6],
      assignTimestamp: result[7],
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 0,
        licenseId: 0n,
        owner: "0x0000000000000000000000000000000000000000",
        nodeAddress: "0x0000000000000000000000000000000000000000",
        totalAssignedAmount: 0n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 0n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get Node license - nd license", async function () {
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

    let result = await reader.getNodeLicenseDetails(NODE_ADDRESS);
    const mapped = {
      licenseType: result[0],
      licenseId: result[1],
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4],
      totalClaimedAmount: result[5],
      lastClaimEpoch: result[6],
      assignTimestamp: result[7],
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 1,
        licenseId: 1n,
        owner: await firstUser.getAddress(),
        nodeAddress: NODE_ADDRESS,
        totalAssignedAmount: 1575188843457943924200n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767604n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get Node license - mnd license", async function () {
    await MNDlinkNode(mndContract, owner, 1);
    let result = await reader.getNodeLicenseDetails(NODE_ADDRESS);
    const mapped = {
      licenseType: result[0],
      licenseId: result[1],
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4],
      totalClaimedAmount: result[5],
      lastClaimEpoch: result[6],
      assignTimestamp: result[7],
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: await owner.getAddress(),
        nodeAddress: NODE_ADDRESS,
        totalAssignedAmount: 46761182022000000000000000n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767601n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get user license - nd license", async function () {
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

    let arrayRes = await reader.getUserLicenses(await firstUser.getAddress());
    let result = arrayRes[0];
    const mapped = {
      licenseType: result[0],
      licenseId: result[1],
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4],
      totalClaimedAmount: result[5],
      lastClaimEpoch: result[6],
      assignTimestamp: result[7],
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 1,
        licenseId: 1n,
        owner: await firstUser.getAddress(),
        nodeAddress: NODE_ADDRESS,
        totalAssignedAmount: 1575188843457943924200n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767604n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get user license - mnd license", async function () {
    await MNDlinkNode(mndContract, owner, 1);

    let arrayRes = await reader.getUserLicenses(await owner.getAddress());
    let result = arrayRes[0];
    const mapped = {
      licenseType: result[0],
      licenseId: result[1],
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4],
      totalClaimedAmount: result[5],
      lastClaimEpoch: result[6],
      assignTimestamp: result[7],
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: await owner.getAddress(),
        nodeAddress: NODE_ADDRESS,
        totalAssignedAmount: 46761182022000000000000000n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767601n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get user license - no license", async function () {
    let arrayRes = await reader.getUserLicenses(await firstUser.getAddress());
    expect(arrayRes).to.deep.equal([]);
  });

  it("Get user license - nd and mnd license", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      owner,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await signAddress(backend, owner, invoiceUuid, 10000)
    );
    await linkNode(
      ndContract,
      owner,
      1,
      "0xbAAD8E10951D09937Aa8C9D2805608ac4754215a"
    );
    await MNDlinkNode(mndContract, owner, 1);

    let arrayRes = await reader.getUserLicenses(await owner.getAddress());
    let mapped_results = [];
    for (let i = 0; i < arrayRes.length; i++) {
      let result = arrayRes[i];
      const mapped = {
        licenseType: result[0],
        licenseId: result[1],
        owner: result[2],
        nodeAddress: result[3],
        totalAssignedAmount: result[4],
        totalClaimedAmount: result[5],
        lastClaimEpoch: result[6],
        assignTimestamp: result[7],
        lastClaimOracle: result[8],
        isBanned: result[9],
      };
      mapped_results.push(mapped);
    }
    expect(mapped_results).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: await owner.getAddress(),
        nodeAddress: NODE_ADDRESS,
        totalAssignedAmount: 46761182022000000000000000n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767605n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
      {
        licenseType: 1,
        licenseId: 1n,
        owner: await owner.getAddress(),
        nodeAddress: "0xbAAD8E10951D09937Aa8C9D2805608ac4754215a",
        totalAssignedAmount: 1575188843457943924200n,
        totalClaimedAmount: 0n,
        lastClaimEpoch: 0n,
        assignTimestamp: 1738767604n,
        lastClaimOracle: "0x0000000000000000000000000000000000000000",
        isBanned: false,
      },
    ]);
  });

  it("Get license total supply", async function () {
    let result = await reader.getLicensesTotalSupply();
    const mapped = {
      mndSupply: result[0],
      ndSupply: result[1],
    };
    expect(mapped).to.deep.equal({
      mndSupply: 1n,
      ndSupply: 0n,
    });
  });

  it("Get Node License Details By Node", async function () {
    await MNDlinkNode(mndContract, owner, 1);
    let result = await reader.getNodeLicenseDetailsByNode(NODE_ADDRESS);
    const mapped = {
      licenseId: result[0],
      owner: result[1],
      assignTimestamp: result[2],
    };
    expect(mapped).to.deep.equal({
      licenseId: 1n,
      owner: await owner.getAddress(),
      assignTimestamp: 1738767601n,
    });
  });

  it("Get wallet nodes", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      owner,
      await ndContract.getLicenseTokenPrice(),
      1,
      1,
      10000,
      20,
      await signAddress(backend, owner, invoiceUuid, 10000)
    );
    await linkNode(
      ndContract,
      owner,
      1,
      "0xbAAD8E10951D09937Aa8C9D2805608ac4754215a"
    );
    await MNDlinkNode(mndContract, owner, 1);
    let result = await reader.getWalletNodes(await owner.getAddress());
    expect(result).to.deep.equal([
      NODE_ADDRESS,
      "0xbAAD8E10951D09937Aa8C9D2805608ac4754215a",
    ]);
  });

  it("Get Oracles details", async function () {
    let result = await reader.getOraclesDetails();
    const mapped = result.map((oracle) => ({
      oracleAddress: oracle[0],
      signaturesCount: oracle[1],
      additionTimestamp: oracle[2],
    }));
    oracle_assignation_timestamp += 1; // Increment to simulate the addition timestamp
    expect(mapped).to.deep.equal([
      {
        oracleAddress: await backend.getAddress(),
        signaturesCount: 0n,
        additionTimestamp: oracle_assignation_timestamp,
      },
    ]);
  });

  it("Get addresses balances", async function () {
    let amount = 10000n;
    let decimals = 10n ** 18n;
    await r1Contract.connect(owner).mint(await firstUser.getAddress(), amount);
    let result = await reader.getAddressesBalances([
      await firstUser.getAddress(),
    ]);
    const mapped = result.map((balance) => ({
      address: balance[0],
      balance: balance[1],
    }));
    expect(mapped).to.deep.equal([
      {
        address: await firstUser.getAddress(),
        balance: amount * decimals,
      },
    ]);
  });
});
