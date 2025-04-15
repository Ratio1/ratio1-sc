import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { R1, NDContract, Controller } from "../../typechain-types";

const BigNumber = ethers.BigNumber;

// npx hardhat test     ---- for gas usage
// npx hardhat coverage ---- for test coverage

/*
..######...#######..##....##..######..########....###....##....##.########..######.
.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
..######...#######..##....##..######.....##....##.....##.##....##....##.....######.
*/

const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const newCompanyWallet = "0x0000000000000000000000000000000000000009";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const REWARDS_AMOUNT = BigNumber.from("3260194774041496137");
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: BigNumber.from(1),
  rewardsAmount: REWARDS_AMOUNT,
};
const START_EPOCH_TIMESTAMP = 1738767600;
const EXPECTED_LICENSES_INFO = [
  {
    licenseId: BigNumber.from(1),
    nodeAddress: NODE_ADDRESS,
    totalClaimedAmount: BigNumber.from(0),
    remainingAmount: BigNumber.from("1575188843457943925233"),
    lastClaimEpoch: BigNumber.from(0),
    claimableEpochs: BigNumber.from(2),
    assignTimestamp: BigNumber.from(1738767604),
  },
];
const EPOCH_IN_A_DAY = 1;

const EXPECTED_PRICE_TIERS = [
  {
    usdPrice: BigNumber.from(500),
    totalUnits: BigNumber.from(89),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(750),
    totalUnits: BigNumber.from(144),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(1000),
    totalUnits: BigNumber.from(233),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(1500),
    totalUnits: BigNumber.from(377),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(2000),
    totalUnits: BigNumber.from(610),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(2500),
    totalUnits: BigNumber.from(987),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(3000),
    totalUnits: BigNumber.from(1597),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(3500),
    totalUnits: BigNumber.from(2584),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(4000),
    totalUnits: BigNumber.from(4181),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(5000),
    totalUnits: BigNumber.from(6765),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(7000),
    totalUnits: BigNumber.from(10946),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(9500),
    totalUnits: BigNumber.from(17711),
    soldUnits: BigNumber.from(0),
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
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let backend: SignerWithAddress;
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
    r1Contract = await R1Contract.deploy(owner.address);

    const USDCContract = await ethers.getContractFactory("ERC20Mock");
    let usdcContract = await USDCContract.deploy();

    const ControllerContract = await ethers.getContractFactory("Controller");
    controllerContract = await ControllerContract.deploy(
      START_EPOCH_TIMESTAMP,
      86400
    );
    await controllerContract.addOracle(backend.address);

    const NDContract = await ethers.getContractFactory("NDContract");
    ndContract = await NDContract.deploy(
      r1Contract.address,
      controllerContract.address,
      owner.address
    );

    const MNDContract = await ethers.getContractFactory("MNDContract");
    let mndContract = await MNDContract.deploy(
      r1Contract.address,
      controllerContract.address,
      owner.address
    );

    await ndContract.setMNDContract(mndContract.address);

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
    await ndContract.setCompanyWallets(newCompanyWallet, newLpWallet);
    await usdcContract.mint(
      uniswapMockRouterContract.address,
      BigNumber.from("500000000000000000000")
    );

    await r1Contract.setNdContract(ndContract.address);
    await r1Contract.setMndContract(owner.address);

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
    owner: SignerWithAddress,
    user: SignerWithAddress,
    numTokens: bigint,
    numLicenses: number,
    priceTier: number,
    usdMintLimit: number,
    signature: string
  ) {
    await r1Contract.connect(owner).mint(user.address, numTokens);
    await r1Contract.connect(user).approve(ndContract.address, numTokens);
    await ndContract
      .connect(user)
      .buyLicense(
        numLicenses,
        priceTier,
        BigNumber.from(numTokens).add(BigNumber.from(numTokens).div(10)),
        invoiceUuid,
        usdMintLimit,
        Buffer.from(signature, "hex")
      );
  }

  async function linkNode(
    ndContract: NDContract,
    user: SignerWithAddress,
    licenseId: number
  ) {
    await ndContract.connect(user).linkNode(licenseId, NODE_ADDRESS);
  }

  async function unlinkNode(
    ndContract: NDContract,
    user: SignerWithAddress,
    licenseId: number
  ) {
    await ndContract.connect(user).unlinkNode(licenseId);
  }

  async function signAddress(
    signer: SignerWithAddress,
    user: SignerWithAddress,
    invoiceUuid: Buffer,
    usdMintLimit: number
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

  async function signComputeParams(signer: SignerWithAddress) {
    let messageBytes = Buffer.from(COMPUTE_PARAMS.nodeAddress.slice(2), "hex");

    for (const epoch of COMPUTE_PARAMS.epochs) {
      const epochBytes = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(epoch),
        32
      );
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(epochBytes.slice(2), "hex"),
      ]);
    }

    for (const availability of COMPUTE_PARAMS.availabilies) {
      const availabilityBytes = ethers.utils.hexZeroPad(
        ethers.utils.hexlify(availability),
        32
      );
      messageBytes = Buffer.concat([
        messageBytes,
        Buffer.from(availabilityBytes.slice(2), "hex"),
      ]);
    }

    const messageHash = ethers.utils.keccak256(messageBytes);
    let signature = await signer.signMessage(
      ethers.utils.arrayify(messageHash)
    );
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await updateTimestamp();

    let result = await ndContract.getLicenses(firstUser.address);
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
    let result = await ndContract.getLicenses(firstUser.address);
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
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Get token uri", async function () {
    let baseUri = "PIPPO.com/";
    await ndContract.setBaseURI(baseUri);

    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    let result = await ndContract.tokenURI(BigNumber.from(1));
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
    let licenseTokenPrice = (
      await ndContract.getLicenseTokenPrice()
    ).toBigInt();
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    expect(firstUser.address).to.equal(await ndContract.ownerOf(1));
    let newCompanyWalletAmount = await r1Contract.balanceOf(newCompanyWallet);
    let newLpWalletAmount = await r1Contract.balanceOf(newLpWallet);
    //TODO check values
    expect("100").to.deep.equal(newLpWalletAmount);
    expect("499999500000000000499").to.deep.equal(newCompanyWalletAmount);

    let total = newLpWalletAmount.add(newCompanyWalletAmount);
    expect(total).to.be.equal(
      (licenseTokenPrice * BigInt(30)) / BigInt(100) + BigInt(100)
    );
    // TODO why plus 100? for remaining on add liquidity?
  });

  it("Buy license - insufficent allowance", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        (await ndContract.getLicenseTokenPrice()).toBigInt() - 100n,
        1,
        1,
        10000,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("Buy license - Price exceeds max accepted", async function () {
    //Mint tokens
    await r1Contract
      .connect(owner)
      .mint(
        firstUser.address,
        (await ndContract.getLicenseTokenPrice()).toBigInt()
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
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        1,
        1,
        10000,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Pausable: paused");
  });

  it("Buy license - wrong signature", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        1,
        1,
        10000,
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
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        1,
        2,
        10000,
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
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        maxUnits + 1,
        1,
        10000,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Exceeds mint limit");
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    //DO TEST
    await linkNode(ndContract, firstUser, 1);
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(firstUser.address);
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NODE_ADDRESS);
    expect(await ndContract.registeredNodeAddresses(NODE_ADDRESS)).to.equal(
      true
    );
  });

  it("Link node - address already registered", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    //DO TEST - try to link with wrong license
    await expect(linkNode(ndContract, firstUser, 2)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    //DO TEST - try to link with wrong node address
    await expect(
      ndContract.connect(firstUser).linkNode(1, NULL_ADDRESS)
    ).to.be.revertedWith("Invalid node address");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );

    //DO TEST - transfer empty license
    await ndContract
      .connect(firstUser)
      .transferFrom(firstUser.address, secondUser.address, 1);
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(secondUser.address);
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Transfer - linked license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);

    //DO TEST - transfer linked license
    await ndContract
      .connect(firstUser)
      .transferFrom(firstUser.address, secondUser.address, 1);
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(secondUser.address);
    expect((await ndContract.licenses(1)).nodeAddress).to.equal(NULL_ADDRESS);
  });

  it("Calculate rewards", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await ethers.provider.send("evm_increaseTime", [
      ONE_DAY_IN_SECS / EPOCH_IN_A_DAY,
    ]);
    await ndContract
      .connect(firstUser)
      .linkNode(1, "0x1351504af17BFdb80491D9223d6Bcb6BB964DCeD");
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    await ndContract.connect(firstUser).claimRewards(
      [
        {
          licenseId: 1,
          nodeAddress: "0x1351504af17BFdb80491D9223d6Bcb6BB964DCeD",
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
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      BigNumber.from("0")
    );
  });

  it("Claim rewards - mismatched input arrays length", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await controllerContract.addOracle(secondUser.address);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
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
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [
      (ONE_DAY_IN_SECS * 5) / EPOCH_IN_A_DAY,
    ]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
    //should not modify amount
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - max release per license", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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

    let expected_result = BigNumber.from("1575188843457943925233");
    //DO TEST
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      expected_result
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
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      expected_result //should not be changed
    );
  });

  it("Claim rewards - full history claim with 5 oracles", async function () {
    //SETUP WORLD
    let [oracle1, oracle2, oracle3, oracle4, oracle5] = (
      await ethers.getSigners()
    ).slice(15, 20);
    await controllerContract.addOracle(oracle1.address);
    await controllerContract.addOracle(oracle2.address);
    await controllerContract.addOracle(oracle3.address);
    await controllerContract.addOracle(oracle4.address);
    await controllerContract.addOracle(oracle5.address);
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 36 * 30]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < 36 * 30; i++) {
      COMPUTE_PARAMS.epochs[i] = i;
      COMPUTE_PARAMS.availabilies[i] = 255;
    }

    let expected_result = BigNumber.from("1575188843457943924200");
    //DO TEST
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
    expect(await r1Contract.balanceOf(firstUser.address)).to.equal(
      expected_result
    );
  });

  it("Add signer - should work", async function () {
    //ADD second user as a signer
    await controllerContract.addOracle(secondUser.address);

    //Should not be reverted
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        1,
        1,
        10000,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Pausable: paused");
  });

  it("Pause contract - not the owner", async function () {
    await expect(ndContract.connect(firstUser).pause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("Unpause contract - should work", async function () {
    await ndContract.connect(owner).pause();
    await expect(
      buyLicenseWithMintAndAllowance(
        r1Contract,
        ndContract,
        owner,
        firstUser,
        (await ndContract.getLicenseTokenPrice()).toBigInt(),
        1,
        1,
        10000,
        await signAddress(backend, firstUser, invoiceUuid, 10000)
      )
    ).to.be.revertedWith("Pausable: paused");

    await ndContract.connect(owner).unpause();

    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
      await signAddress(backend, firstUser, invoiceUuid, 10000)
    );
  });

  it("Unpause contract - not the owner", async function () {
    await ndContract.connect(owner).pause();
    await expect(ndContract.connect(firstUser).unpause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it("Ban license - should work", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Unban license - should work", async function () {
    await buyLicenseWithMintAndAllowance(
      r1Contract,
      ndContract,
      owner,
      firstUser,
      (await ndContract.getLicenseTokenPrice()).toBigInt(),
      1,
      1,
      10000,
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
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Unban license - not banned license", async function () {
    await expect(ndContract.connect(owner).unbanLicense(1)).to.be.revertedWith(
      "License is not banned"
    );
  });

  it.skip("Buy all license ", async function () {
    //TODO fix
    // for gas test remove this function using "it.skip"
    //SETUP WORLD
    const signedMessage = await signAddress(
      backend,
      firstUser,
      invoiceUuid,
      10000
    );

    //DO TEST
    for (let i = 1; i <= 12; i++) {
      expect(await ndContract.currentPriceTier()).to.equal(i);
      let tier = await ndContract._priceTiers(i);
      let units = tier.totalUnits.toNumber();
      do {
        if (units > maxUnits) {
          await buyLicenseWithMintAndAllowance(
            r1Contract,
            ndContract,
            owner,
            firstUser,
            (await ndContract.getLicenseTokenPrice()).toBigInt() *
              BigInt(maxUnits),
            maxUnits,
            i,
            10000,
            signedMessage
          );
          units -= maxUnits;
        } else {
          await buyLicenseWithMintAndAllowance(
            r1Contract,
            ndContract,
            owner,
            firstUser,
            (await ndContract.getLicenseTokenPrice()).toBigInt() *
              BigInt(units),
            units,
            i,
            10000,
            signedMessage
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
        (await ndContract.getLicenseTokenPrice()).toBigInt() * 1000n,
        1,
        12,
        10000,
        signedMessage
      )
    ).to.be.revertedWith("All licenses have been sold");
  });
});
