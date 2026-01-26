import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
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
  revertSnapshotAndCapture,
  setTimestampAndMine,
  signBuyLicense,
  signLinkNode,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
} from "./helpers";
import {
  R1,
  NDContract,
  Controller,
  Reader,
  MNDContract,
  PoAIManager,
  CspEscrow,
  ERC20Mock,
} from "../typechain-types";

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
const PERMISSION_CREATE_JOBS = 1n << 0n;
const PERMISSION_EXTEND_NODES = 1n << 2n;
const OWNER_ESCROW_PERMISSIONS = (1n << 256n) - 1n;

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
  let usdcContract: ERC20Mock;

  before(async function () {
    await network.provider.request({ method: "hardhat_reset", params: [] });

    const [deployer, user1, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    backend = backendSigner;

    r1Contract = await deployR1(owner);
    const BurnContractFactory = await ethers.getContractFactory("BurnContract");
    const burnContract = await BurnContractFactory.deploy(
      await r1Contract.getAddress()
    );
    await burnContract.waitForDeployment();
    await r1Contract.addBurner(await burnContract.getAddress());
    controllerContract = await deployController({
      owner,
    });
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    oracle_assignation_timestamp = block?.timestamp || 0;
    await controllerContract.addOracle(await backend.getAddress());

    ndContract = await deployNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });
    await ndContract.connect(owner).setDirectAddLpPercentage(50_00n);

    mndContract = await deployMNDContract({
      r1: r1Contract,
      controller: controllerContract,
      owner,
    });

    await controllerContract.setContracts(
      await ndContract.getAddress(),
      await mndContract.getAddress()
    );

    await mndContract.setNDContract(await ndContract.getAddress());
    await ndContract.setMNDContract(await mndContract.getAddress());
    await r1Contract.setNdContract(await ndContract.getAddress());
    await r1Contract.setMndContract(await owner.getAddress()); // just for test to be able to mint R1

    const { usdc, router, pair } = await deployUniswapMocks(r1Contract);
    usdcContract = usdc;

    await ndContract.setUniswapParams(
      await router.getAddress(),
      await pair.getAddress(),
      await usdcContract.getAddress()
    );
    await ndContract.setCompanyWallets(
      newCompanyWallet,
      newLpWallet,
      newVatWallet
    );
    await usdcContract.mint(await router.getAddress(), 500n * 10n ** 18n);

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
        await burnContract.getAddress(),
        await router.getAddress(),
        await pair.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.waitForDeployment();

    await ndContract
      .connect(owner)
      .setPoAIManager(await poaiManager.getAddress());

    const ReaderContract = await ethers.getContractFactory("Reader");
    reader = await ReaderContract.deploy();

    await reader.initialize(
      await ndContract.getAddress(),
      await mndContract.getAddress(),
      await controllerContract.getAddress(),
      await r1Contract.getAddress(),
      await poaiManager.getAddress()
    );

    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  beforeEach(async function () {
    //ADD TWO DAYS TO REACH START EPOCH
    await setTimestampAndMine(START_EPOCH_TIMESTAMP);
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
    return buyLicenseWithMintAndAllowanceHelper({
      r1: r1Contract,
      nd: ndContract,
      mintAuthority: owner,
      buyer: user,
      pricePerLicense: numTokens,
      licenseCount: numLicenses,
      priceTier,
      invoiceUuid,
      usdMintLimit,
      vatPercent,
      signature,
    });
  }

  async function createLicenseSignature(
    signer: HardhatEthersSigner,
    user: HardhatEthersSigner,
    invoice: Buffer,
    usdMintLimit: number,
    vatPercent: number = 20
  ) {
    return signBuyLicense(
      signer,
      await user.getAddress(),
      invoice,
      usdMintLimit,
      vatPercent
    );
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

  type OracleDetailsOutput = Awaited<
    ReturnType<Reader["getOraclesDetails"]>
  >[number];
  type AddressBalanceOutput = Awaited<
    ReturnType<Reader["getAddressesBalances"]>
  >[number];
  type EscrowDetailsOutput = Awaited<
    ReturnType<Reader["getAllEscrowsDetails"]>
  >[number];
  type EscrowDetailsSingleOutput = Awaited<
    ReturnType<Reader["getEscrowDetailsByOwner"]>
  >;
  type NdNodeOwnerOutput = Awaited<
    ReturnType<Reader["getNdNodesOwners"]>
  >[number];
  type UserEscrowDetailsOutput = Awaited<
    ReturnType<Reader["getUserEscrowDetails"]>
  >;

  function formatOracleDetails(oracle: OracleDetailsOutput) {
    return {
      oracleAddress: oracle[0],
      signaturesCount: oracle[1],
      additionTimestamp: oracle[2],
    };
  }

  function formatAddressBalance(balance: AddressBalanceOutput) {
    return {
      address: balance[0],
      balance: balance[1],
    };
  }

  function formatEscrowDetails(
    escrow: EscrowDetailsOutput | EscrowDetailsSingleOutput
  ) {
    return {
      escrowAddress: escrow[0],
      owner: escrow[1],
      tvl: escrow[2],
      activeJobsCount: escrow[3],
    };
  }

  function formatNdNodeOwner(nodeOwner: NdNodeOwnerOutput) {
    return {
      nodeAddress: nodeOwner[0],
      owner: nodeOwner[1],
    };
  }

  function formatUserEscrowDetails(details: UserEscrowDetailsOutput) {
    return {
      isActive: details[0],
      escrowAddress: details[1],
      escrowOwner: details[2],
      permissions: details[3],
    };
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
      await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
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
      await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
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
      await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
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
      await createLicenseSignature(backend, owner, invoiceUuid, 10000)
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
      await createLicenseSignature(backend, owner, invoiceUuid, 10000)
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
    const mapped = result.map(formatOracleDetails);
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
    const mapped = result.map(formatAddressBalance);
    expect(mapped).to.deep.equal([
      {
        address: await firstUser.getAddress(),
        balance: amount * decimals,
      },
    ]);
  });

  describe("getAllEscrowsDetails", function () {
    it("returns empty array when no escrows deployed", async function () {
      const result = await reader.getAllEscrowsDetails();
      expect(result).to.deep.equal([]);
    });

    it("returns escrow details for deployed escrows", async function () {
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
        await createLicenseSignature(backend, owner, invoiceUuid, 10000)
      );
      await linkNode(ndContract, owner, 1, await backend.getAddress());

      await poaiManager.connect(owner).deployCspEscrow();
      const escrowAddress = await poaiManager.ownerToEscrow(
        await owner.getAddress()
      );

      const result = await reader.getAllEscrowsDetails();
      const mapped = result.map(formatEscrowDetails);

      expect(mapped).to.deep.equal([
        {
          escrowAddress,
          owner: await owner.getAddress(),
          tvl: 0n,
          activeJobsCount: 0n,
        },
      ]);
    });
  });

  describe("getEscrowDetailsByOwner", function () {
    it("returns empty structure when owner has no escrow", async function () {
      const ownerWithoutEscrow = await firstUser.getAddress();
      const result = await reader.getEscrowDetailsByOwner(ownerWithoutEscrow);
      const mapped = formatEscrowDetails(result);
      expect(mapped).to.deep.equal({
        escrowAddress: NULL_ADDRESS,
        owner: NULL_ADDRESS,
        tvl: 0n,
        activeJobsCount: 0n,
      });
    });

    it("returns escrow details for owner with escrow", async function () {
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
        await createLicenseSignature(backend, owner, invoiceUuid, 10000)
      );
      await linkNode(ndContract, owner, 1, await backend.getAddress());

      await poaiManager.connect(owner).deployCspEscrow();
      const escrowAddress = await poaiManager.ownerToEscrow(
        await owner.getAddress()
      );

      const result = await reader.getEscrowDetailsByOwner(
        await owner.getAddress()
      );
      const mapped = formatEscrowDetails(result);

      expect(mapped).to.deep.equal({
        escrowAddress,
        owner: await owner.getAddress(),
        tvl: 0n,
        activeJobsCount: 0n,
      });
    });
  });

  describe("getUserEscrowDetails", function () {
    it("returns inactive details for unregistered users", async function () {
      const result = await reader.getUserEscrowDetails(
        await firstUser.getAddress()
      );
      const mapped = formatUserEscrowDetails(result);

      expect(mapped).to.deep.equal({
        isActive: false,
        escrowAddress: NULL_ADDRESS,
        escrowOwner: NULL_ADDRESS,
        permissions: 0n,
      });
    });

    it("returns owner permissions for escrow owners", async function () {
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
        await createLicenseSignature(backend, owner, invoiceUuid, 10000)
      );
      await linkNode(ndContract, owner, 1, await backend.getAddress());

      await poaiManager.connect(owner).deployCspEscrow();
      const escrowAddress = await poaiManager.ownerToEscrow(
        await owner.getAddress()
      );

      const result = await reader.getUserEscrowDetails(
        await owner.getAddress()
      );
      const mapped = formatUserEscrowDetails(result);

      expect(mapped).to.deep.equal({
        isActive: true,
        escrowAddress,
        escrowOwner: await owner.getAddress(),
        permissions: OWNER_ESCROW_PERMISSIONS,
      });
    });

    it("returns delegate permissions for delegated addresses", async function () {
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
        await createLicenseSignature(backend, owner, invoiceUuid, 10000)
      );
      await linkNode(ndContract, owner, 1, await backend.getAddress());

      await poaiManager.connect(owner).deployCspEscrow();
      const escrowAddress = await poaiManager.ownerToEscrow(
        await owner.getAddress()
      );

      const cspEscrow = (await ethers.getContractAt(
        "CspEscrow",
        escrowAddress
      )) as unknown as CspEscrow;
      const delegateAddress = await firstUser.getAddress();
      const permissions = PERMISSION_CREATE_JOBS | PERMISSION_EXTEND_NODES;

      await cspEscrow
        .connect(owner)
        .setDelegatePermissions(delegateAddress, permissions);

      const result = await reader.getUserEscrowDetails(delegateAddress);
      const mapped = formatUserEscrowDetails(result);

      expect(mapped).to.deep.equal({
        isActive: true,
        escrowAddress,
        escrowOwner: await owner.getAddress(),
        permissions,
      });
    });
  });

  describe("getNdNodesOwners", function () {
    it("returns owners for ND nodes", async function () {
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
        await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
      );
      await linkNode(ndContract, firstUser, 1);

      const result = await reader.getNdNodesOwners([NODE_ADDRESS]);
      const mapped = result.map(formatNdNodeOwner);

      expect(mapped).to.deep.equal([
        {
          nodeAddress: NODE_ADDRESS,
          owner: await firstUser.getAddress(),
        },
      ]);
    });

    it("returns zero owner for unregistered nodes", async function () {
      const randomNodeAddress = ethers.Wallet.createRandom().address;

      const result = await reader.getNdNodesOwners([randomNodeAddress]);
      const mapped = result.map(formatNdNodeOwner);

      expect(mapped).to.deep.equal([
        {
          nodeAddress: randomNodeAddress,
          owner: NULL_ADDRESS,
        },
      ]);
    });

    it("ignores MND nodes when resolving owners", async function () {
      const mndNodeAddress = ethers.Wallet.createRandom().address;
      await mndContract
        .connect(owner)
        .linkNode(
          1,
          mndNodeAddress,
          await signLinkNode(backend, owner, mndNodeAddress)
        );

      const result = await reader.getNdNodesOwners([mndNodeAddress]);
      const mapped = result.map(formatNdNodeOwner);

      expect(mapped).to.deep.equal([
        {
          nodeAddress: mndNodeAddress,
          owner: NULL_ADDRESS,
        },
      ]);
    });
  });

  describe("getJobsByLastExecutionEpochDelta", function () {
    async function setupEscrowWithJobs() {
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
        await createLicenseSignature(backend, owner, invoiceUuid, 10000)
      );
      await linkNode(ndContract, owner, 1, await backend.getAddress());

      await poaiManager.connect(owner).deployCspEscrow();
      const escrowAddress = await poaiManager.ownerToEscrow(
        await owner.getAddress()
      );
      const cspEscrow = (await ethers.getContractAt(
        "CspEscrow",
        escrowAddress
      )) as unknown as CspEscrow;

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const jobDurationA = 30n;
      const jobDurationB = 31n;
      const jobDurationC = 40n;
      const lastExecutionEpochA = currentEpoch + jobDurationA;
      const lastExecutionEpochB = currentEpoch + jobDurationB;
      const lastExecutionEpochC = currentEpoch + jobDurationC;
      const numberOfNodesRequested = 1n;
      const jobType = 1;
      const pricePerEpoch = await cspEscrow.getPriceForJobType(jobType);
      const totalCost =
        pricePerEpoch *
        numberOfNodesRequested *
        (jobDurationA + jobDurationB + jobDurationC);

      await usdcContract.mint(await owner.getAddress(), totalCost);
      await usdcContract.connect(owner).approve(escrowAddress, totalCost);

      await cspEscrow.connect(owner).createJobs([
        {
          jobType,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("reader-job-a")),
          lastExecutionEpoch: lastExecutionEpochA,
          numberOfNodesRequested,
        },
        {
          jobType,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("reader-job-b")),
          lastExecutionEpoch: lastExecutionEpochB,
          numberOfNodesRequested,
        },
        {
          jobType,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("reader-job-c")),
          lastExecutionEpoch: lastExecutionEpochC,
          numberOfNodesRequested,
        },
      ]);

      return { escrowAddress };
    }

    it("filters jobs by epoch delta", async function () {
      await setupEscrowWithJobs();

      await setTimestampAndMine(START_EPOCH_TIMESTAMP + ONE_DAY_IN_SECS * 31);

      const deltaOne = await reader.getJobsByLastExecutionEpochDelta(1);
      expect(deltaOne.map((job) => job.id)).to.deep.equal([1n]);

      const deltaZero = await reader.getJobsByLastExecutionEpochDelta(0);
      expect(deltaZero.map((job) => job.id)).to.deep.equal([2n]);
    });

    it("returns empty array when no jobs match", async function () {
      await setupEscrowWithJobs();

      await setTimestampAndMine(START_EPOCH_TIMESTAMP + ONE_DAY_IN_SECS * 31);

      const result = await reader.getJobsByLastExecutionEpochDelta(5);
      expect(result).to.deep.equal([]);
    });
  });

  describe("hasOracleNode", function () {
    it("returns false for wallet without linked nodes", async function () {
      const result = await reader.hasOracleNode(await firstUser.getAddress());
      expect(result).to.equal(false);
    });

    it("returns false when user nodes are not oracles", async function () {
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
        await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
      );
      await linkNode(ndContract, firstUser, 1);

      const result = await reader.hasOracleNode(await firstUser.getAddress());
      expect(result).to.equal(false);
    });

    it("returns true when user has ND node operated by oracle", async function () {
      const oracleAddress = await backend.getAddress();
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
        await createLicenseSignature(backend, firstUser, invoiceUuid, 10000)
      );
      await linkNode(ndContract, firstUser, 1, oracleAddress);

      const result = await reader.hasOracleNode(await firstUser.getAddress());
      expect(result).to.equal(true);
    });

    it("returns true when user has MND node operated by oracle", async function () {
      const oracleAddress = await backend.getAddress();
      await mndContract
        .connect(owner)
        .linkNode(
          1,
          oracleAddress,
          await signLinkNode(backend, owner, oracleAddress)
        );

      const result = await reader.hasOracleNode(await owner.getAddress());
      expect(result).to.equal(true);
    });
  });
});
