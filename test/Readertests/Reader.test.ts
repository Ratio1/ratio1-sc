import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  R1,
  NDContract,
  Controller,
  Reader,
  MNDContract,
  PoAIManager,
} from "../../typechain-types";
import { Contract } from "ethers";
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
  let owner: SignerWithAddress;
  let backend: SignerWithAddress;
  let snapshotId: string;
  let ndContract: NDContract;
  let mndContract: MNDContract;
  let poaiManager: Contract;
  let firstUser: SignerWithAddress;
  let oracle_assignation_timestamp: number;

  before(async function () {
    await network.provider.request({ method: "hardhat_reset", params: [] });

    const [deployer, user1, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    backend = backendSigner;

    const R1Contract = await ethers.getContractFactory("R1");
    r1Contract = await R1Contract.deploy(owner.address);

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400,
      owner.address
    );
    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    oracle_assignation_timestamp = block.timestamp;
    await controllerContract.addOracle(backend.address);

    const NDContractFactory = await ethers.getContractFactory("NDContract");
    ndContract = (await upgrades.deployProxy(
      NDContractFactory,
      [r1Contract.address, controllerContract.address, owner.address],
      { initializer: "initialize" }
    )) as NDContract;

    const MNDContractFactory = await ethers.getContractFactory("MNDContract");
    mndContract = (await upgrades.deployProxy(
      MNDContractFactory,
      [r1Contract.address, controllerContract.address, owner.address],
      { initializer: "initialize" }
    )) as unknown as MNDContract;

    await controllerContract.setContracts(
      ndContract.address,
      mndContract.address
    );

    await mndContract.setNDContract(ndContract.address);
    await ndContract.setMNDContract(mndContract.address);
    await r1Contract.setNdContract(ndContract.address);
    await r1Contract.setMndContract(owner.address); // to mint r1 tokens

    let LpPercentage = BigNumber.from(50_00);
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
      usdcContract.address,
      r1Contract.address
    );

    await ndContract.setUniswapParams(
      uniswapMockRouterContract.address,
      uniswapMockPairContract.address,
      usdcContract.address
    );
    await ndContract.setCompanyWallets(
      newCompanyWallet,
      newLpWallet,
      newVatWallet
    );
    await usdcContract.mint(
      uniswapMockRouterContract.address,
      BigNumber.from(500).mul(10).pow(18)
    );

    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrowImplementation = await CspEscrow.deploy();
    await cspEscrowImplementation.deployed();

    const PoAIManager = await ethers.getContractFactory("PoAIManager");
    poaiManager = await upgrades.deployProxy(
      PoAIManager,
      [
        cspEscrowImplementation.address,
        ndContract.address,
        mndContract.address,
        controllerContract.address,
        usdcContract.address,
        r1Contract.address,
        uniswapMockRouterContract.address,
        uniswapMockPairContract.address,
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.deployed();

    const ReaderContract = await ethers.getContractFactory("Reader");
    reader = await ReaderContract.deploy();

    await reader.initialize(
      ndContract.address,
      mndContract.address,
      controllerContract.address,
      r1Contract.address,
      poaiManager.address
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
    owner: SignerWithAddress,
    user: SignerWithAddress,
    numTokens: bigint,
    numLicenses: number,
    priceTier: number,
    usdMintLimit: number,
    vatPercent: number,
    signature: string
  ) {
    let _NUM_TOKENS =
      numTokens + (numTokens * BigInt(vatPercent)) / BigInt(100);
    let _MAX_ACCEPTED_NUM_TOKENS = BigNumber.from(_NUM_TOKENS).add(
      BigNumber.from(_NUM_TOKENS).div(10)
    );
    _MAX_ACCEPTED_NUM_TOKENS = _MAX_ACCEPTED_NUM_TOKENS.mul(numLicenses);
    await r1Contract
      .connect(owner)
      .mint(user.address, _MAX_ACCEPTED_NUM_TOKENS);
    await r1Contract
      .connect(user)
      .approve(ndContract.address, _MAX_ACCEPTED_NUM_TOKENS);
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
    signer: SignerWithAddress,
    user: SignerWithAddress,
    invoiceUuid: Buffer,
    usdMintLimit: number,
    vatPercent: number = 20
  ) {
    const addressBytes = Buffer.from(user.address.slice(2), "hex");

    let messageBytes = Buffer.concat([addressBytes, invoiceUuid]);
    const buffer = ethers.utils.hexZeroPad(
      ethers.utils.hexlify(usdMintLimit),
      32
    );
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(buffer.slice(2), "hex"),
    ]);
    const bufferVatPercentage = ethers.utils.hexZeroPad(
      ethers.utils.hexlify(vatPercent),
      32
    );
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(bufferVatPercentage.slice(2), "hex"),
    ]);
    const messageHash = ethers.utils.keccak256(messageBytes);
    const signature = await signer.signMessage(
      ethers.utils.arrayify(messageHash)
    );

    let signatureBytes = Buffer.from(signature.slice(2), "hex");
    if (signatureBytes[64] < 27) {
      signatureBytes[64] += 27;
    }

    return signatureBytes.toString("hex");
  }

  async function signLinkNode(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    nodeAddress: string
  ) {
    const messageHash = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [user.address, nodeAddress]
    );
    return signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  async function linkNode(
    ndContract: NDContract,
    user: SignerWithAddress,
    licenseId: number,
    nodeAddress: string = NODE_ADDRESS
  ) {
    await ndContract
      .connect(user)
      .linkNode(
        licenseId,
        nodeAddress,
        signLinkNode(backend, user, nodeAddress)
      );
  }

  async function MNDlinkNode(
    mndContract: MNDContract,
    user: SignerWithAddress,
    licenseId: number
  ) {
    await mndContract
      .connect(user)
      .linkNode(
        licenseId,
        NODE_ADDRESS,
        signLinkNode(backend, user, NODE_ADDRESS)
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      20,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await expect(reader.getNdLicenseDetails(1)).to.not.be.reverted;
  });

  it("Get Nd license - non existent license", async function () {
    await expect(reader.getNdLicenseDetails(1)).to.be.revertedWith("");
  });

  it("Get MNd license - should work", async function () {
    await expect(reader.getMndLicenseDetails(1)).to.not.be.reverted;
  });

  it("Get MNd license - non existent license", async function () {
    await expect(reader.getMndLicenseDetails(2)).to.be.revertedWith("");
  });

  it("Get Node license - no license", async function () {
    let result = await reader.getNodeLicenseDetails(NODE_ADDRESS);
    const mapped = {
      licenseType: result[0],
      licenseId: result[1].toBigInt(),
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4].toBigInt(),
      totalClaimedAmount: result[5].toBigInt(),
      lastClaimEpoch: result[6].toBigInt(),
      assignTimestamp: result[7].toBigInt(),
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
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
      licenseId: result[1].toBigInt(),
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4].toBigInt(),
      totalClaimedAmount: result[5].toBigInt(),
      lastClaimEpoch: result[6].toBigInt(),
      assignTimestamp: result[7].toBigInt(),
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 1,
        licenseId: 1n,
        owner: firstUser.address,
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
      licenseId: result[1].toBigInt(),
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4].toBigInt(),
      totalClaimedAmount: result[5].toBigInt(),
      lastClaimEpoch: result[6].toBigInt(),
      assignTimestamp: result[7].toBigInt(),
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: owner.address,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      20,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    let arrayRes = await reader.getUserLicenses(firstUser.address);
    let result = arrayRes[0];
    const mapped = {
      licenseType: result[0],
      licenseId: result[1].toBigInt(),
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4].toBigInt(),
      totalClaimedAmount: result[5].toBigInt(),
      lastClaimEpoch: result[6].toBigInt(),
      assignTimestamp: result[7].toBigInt(),
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 1,
        licenseId: 1n,
        owner: firstUser.address,
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

    let arrayRes = await reader.getUserLicenses(owner.address);
    let result = arrayRes[0];
    const mapped = {
      licenseType: result[0],
      licenseId: result[1].toBigInt(),
      owner: result[2],
      nodeAddress: result[3],
      totalAssignedAmount: result[4].toBigInt(),
      totalClaimedAmount: result[5].toBigInt(),
      lastClaimEpoch: result[6].toBigInt(),
      assignTimestamp: result[7].toBigInt(),
      lastClaimOracle: result[8],
      isBanned: result[9],
    };
    expect([mapped]).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: owner.address,
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
    let arrayRes = await reader.getUserLicenses(firstUser.address);
    expect(arrayRes).to.deep.equal([]);
  });

  it("Get user license - nd and mnd license", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      owner,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
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

    let arrayRes = await reader.getUserLicenses(owner.address);
    let mapped_results = [];
    for (let i = 0; i < arrayRes.length; i++) {
      let result = arrayRes[i];
      const mapped = {
        licenseType: result[0],
        licenseId: result[1].toBigInt(),
        owner: result[2],
        nodeAddress: result[3],
        totalAssignedAmount: result[4].toBigInt(),
        totalClaimedAmount: result[5].toBigInt(),
        lastClaimEpoch: result[6].toBigInt(),
        assignTimestamp: result[7].toBigInt(),
        lastClaimOracle: result[8],
        isBanned: result[9],
      };
      mapped_results.push(mapped);
    }
    expect(mapped_results).to.deep.equal([
      {
        licenseType: 3,
        licenseId: 1n,
        owner: owner.address,
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
        owner: owner.address,
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
      mndSupply: result[0].toBigInt(),
      ndSupply: result[1].toBigInt(),
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
      licenseId: result[0].toBigInt(),
      owner: result[1],
      assignTimestamp: result[2].toBigInt(),
    };
    expect(mapped).to.deep.equal({
      licenseId: 1n,
      owner: owner.address,
      assignTimestamp: 1738767601n,
    });
  });

  it("Get wallet nodes", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      owner,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
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
    let result = await reader.getWalletNodes(owner.address);
    expect(result).to.deep.equal([
      NODE_ADDRESS,
      "0xbAAD8E10951D09937Aa8C9D2805608ac4754215a",
    ]);
  });

  it("Get Oracles details", async function () {
    let result = await reader.getOraclesDetails();
    const mapped = result.map((oracle) => ({
      oracleAddress: oracle[0],
      signaturesCount: oracle[1].toBigInt(),
      additionTimestamp: oracle[2].toNumber(),
    }));
    oracle_assignation_timestamp += 1; // Increment to simulate the addition timestamp
    expect(mapped).to.deep.equal([
      {
        oracleAddress: backend.address,
        signaturesCount: 0n,
        additionTimestamp: oracle_assignation_timestamp,
      },
    ]);
  });

  it("Get addresses balances", async function () {
    let amount = BigNumber.from("10000");
    let decimals = BigNumber.from(10).pow(18);
    await r1Contract.connect(owner).mint(firstUser.address, amount);
    let result = await reader.getAddressesBalances([firstUser.address]);
    const mapped = result.map((balance) => ({
      address: balance[0],
      balance: balance[1].toBigInt(),
    }));
    expect(mapped).to.deep.equal([
      {
        address: firstUser.address,
        balance: amount.mul(decimals).toBigInt(),
      },
    ]);
  });
});
