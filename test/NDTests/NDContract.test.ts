import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { NAEURA, NDContract } from "../../typechain-types";
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
const USDC_ADDRESS = "0x6f14C02Fc1F78322cFd7d707aB90f18baD3B54f5";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const newLpWallet = "0x0000000000000000000000000000000000000001";
const newExpensesWallet = "0x0000000000000000000000000000000000000002";
const newMarketingWallet = "0x0000000000000000000000000000000000000003";
const newGrantsWallet = "0x0000000000000000000000000000000000000004";
const newCsrWallet = "0x0000000000000000000000000000000000000005";
const REWARDS_AMOUNT = BigNumber.from("19561168740964714023");
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: BigNumber.from(1),
  rewardsAmount: REWARDS_AMOUNT,
};
const START_EPOCH_TIMESTAMP = 1710028800;
const CURRENT_EPOCH_TIMESTAMP = Math.floor(Date.now() / 1000);
const CLAIMABLE_EPOCHS = Math.floor(
  (CURRENT_EPOCH_TIMESTAMP - START_EPOCH_TIMESTAMP) / ONE_DAY_IN_SECS
);
const EXPECTED_LICENSES_INFO = [
  {
    licenseId: BigNumber.from(1),
    nodeAddress: NULL_ADDRESS,
    totalClaimedAmount: BigNumber.from(0),
    remainingAmount: BigNumber.from("15751888512461059190031"),
    lastClaimEpoch: BigNumber.from(0),
    claimableEpochs: BigNumber.from(CLAIMABLE_EPOCHS),
    assignTimestamp: BigNumber.from(0),
  },
];

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
    usdPrice: BigNumber.from(10000),
    totalUnits: BigNumber.from(10946),
    soldUnits: BigNumber.from(0),
  },
  {
    usdPrice: BigNumber.from(20000),
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
  let naeuraContract: NAEURA;
  let owner: SignerWithAddress;
  let firstUser: SignerWithAddress;
  let secondUser: SignerWithAddress;
  let backend: SignerWithAddress;
  let maxUnits: number;
  let COMPUTE_PARAMS = {
    licenseId: 1,
    nodeAddress: NODE_ADDRESS,
    epochs: [1, 2, 3, 4, 5],
    availabilies: [250, 130, 178, 12, 0],
  };
  let snapshotId: string;

  before(async function () {
    const [deployer, user1, user2, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    backend = backendSigner;

    maxUnits = 5; //TODO change with storage when updated (with maxUnits = 100 it could take up to 95s)

    const NAEURAContract = await ethers.getContractFactory("NAEURA");
    naeuraContract = await NAEURAContract.deploy();

    const NDContract = await ethers.getContractFactory("NDContract");
    ndContract = await NDContract.deploy(naeuraContract.address);
    await ndContract.addSigner(backend.address);

    const MNDContract = await ethers.getContractFactory("MNDContract");
    let mndContract = await MNDContract.deploy(naeuraContract.address);
    await mndContract.addSigner(backend.address);

    await ndContract.setMNDContract(mndContract.address);

    const UniswapContract = await ethers.getContractFactory("UNISWAP");
    const uniswapContract = await UniswapContract.deploy();

    await ndContract.setUniswapRouter(uniswapContract.address);
    await ndContract.setCompanyWallets(
      newLpWallet,
      newExpensesWallet,
      newMarketingWallet,
      newGrantsWallet,
      newCsrWallet
    );
    await ndContract.setUsdcAddress(USDC_ADDRESS);

    await naeuraContract.setNdContract(ndContract.address);
    await naeuraContract.setMndContract(owner.address);

    COMPUTE_PARAMS = {
      licenseId: 1,
      nodeAddress: NODE_ADDRESS,
      epochs: [1, 2, 3, 4, 5],
      availabilies: [250, 130, 178, 12, 0],
    };
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  beforeEach(async function () {
    COMPUTE_PARAMS = {
      licenseId: 1,
      nodeAddress: NODE_ADDRESS,
      epochs: [1, 2, 3, 4, 5],
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
    naeuraContract: NAEURA,
    ndContract: NDContract,
    owner: SignerWithAddress,
    user: SignerWithAddress,
    numTokens: number,
    numLicenses: number,
    priceTier: number,
    signature: string
  ) {
    await naeuraContract
      .connect(owner)
      .mint(user.address, ONE_TOKEN.mul(numTokens));
    await naeuraContract
      .connect(user)
      .approve(ndContract.address, ONE_TOKEN.mul(numTokens));
    await ndContract
      .connect(user)
      .buyLicense(numLicenses, priceTier, Buffer.from(signature, "hex"));
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
    user: SignerWithAddress
  ) {
    const addressBytes = Buffer.from(user.address.slice(2), "hex");
    const messageHash = ethers.utils.keccak256(addressBytes);
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );

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

  it("Set usdc address - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).setUsdcAddress(firstUser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Set uniswap address - not the owner", async function () {
    let baseUri = "PIPPO.com/";
    await expect(
      ndContract.connect(firstUser).setUniswapRouter(firstUser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Get token uri", async function () {
    let baseUri = "PIPPO.com/";
    await ndContract.setBaseURI(baseUri);

    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
    let licenseId = 1;
    let result = await ndContract.tokenURI(BigNumber.from(1));
    expect(baseUri + licenseId).to.equal(result);
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
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
    expect(firstUser.address).to.equal(await ndContract.ownerOf(1));
    expect("40050000000000000000").to.deep.equal(
      await naeuraContract.balanceOf(newLpWallet)
    );
    expect("20700000000000000000").to.deep.equal(
      await naeuraContract.balanceOf(newExpensesWallet)
    );
    expect("11250000000000000000").to.deep.equal(
      await naeuraContract.balanceOf(newMarketingWallet)
    );

    expect("51900000000000000000").to.deep.equal(
      await naeuraContract.balanceOf(newGrantsWallet)
    );
    expect("25950000000000000000").to.deep.equal(
      await naeuraContract.balanceOf(newCsrWallet)
    );
  });

  it("Buy license - insufficent balance", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        499, //since 1 neura = 1 usdc minimum is 500
        1,
        1,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Insufficient NAEURA balance");
  });

  it("Buy license - insufficent allowance", async function () {
    //Mint tokens
    await naeuraContract
      .connect(owner)
      .mint(firstUser.address, ONE_TOKEN.mul(500));

    //Buy license without giving allowance
    await expect(
      ndContract
        .connect(firstUser)
        .buyLicense(
          1,
          1,
          Buffer.from(await signAddress(backend, firstUser), "hex")
        )
    ).to.be.revertedWith("Insufficient allowance");
  });

  it("Buy license - paused contract", async function () {
    //SETUP WORLD
    await ndContract.connect(owner).pause();

    //DO TEST - try to buy license
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        1,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Pausable: paused");
  });

  it("Buy license - wrong signature", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        1,
        await signAddress(secondUser, firstUser)
      )
    ).to.be.revertedWith("Invalid signature");
  });

  it("Buy license- wrong tier", async function () {
    //DO TEST -try buy 1 license in first tier
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        2,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Not in the right price tier");
  });

  it("Buy license- wrong number of lienses", async function () {
    //DO TEST -try buy 1 license in first tier
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        (await ndContract._priceTiers(1)).usdPrice.toNumber() * maxUnits + 1,
        maxUnits + 1,
        1,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Invalid number of licenses");
  });

  it("Link node - should work", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );

    //DO TEST - try to link with wrong license
    await expect(linkNode(ndContract, firstUser, 2)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
  });

  it("Link node - wrong node address", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );

    //DO TEST - try to link with wrong node address
    await expect(
      ndContract.connect(firstUser).linkNode(1, NULL_ADDRESS)
    ).to.be.revertedWith("Invalid node address");
  });

  it("Link node - link again before 24hrs", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
    await ethers.provider.send("evm_mine", []);

    //DO TEST
    await ndContract
      .connect(firstUser)
      .claimRewards(
        [COMPUTE_PARAMS],
        [[Buffer.from(await signComputeParams(backend), "hex")]]
      );
    expect(await naeuraContract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it("Claim rewards - mismatched input arrays length", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
    await linkNode(ndContract, firstUser, 1);
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * 5]);
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
    ).to.be.revertedWith("Invalid signature");
  });

  it("Claim rewards - invalid node address.", async function () {
    //SETUP WORLD
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
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

  it("Add signer - should work", async function () {
    //ADD second user as a signer
    await ndContract.addSigner(secondUser.address);

    //Should not be reverted
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(secondUser, firstUser) //second user is a signer
    );
  });

  it("Add signer - invalid signer address", async function () {
    await expect(ndContract.addSigner(NULL_ADDRESS)).to.be.revertedWith(
      "Invalid signer address"
    );
  });

  it("Add signer - signer already exists", async function () {
    await expect(ndContract.addSigner(backend.address)).to.be.revertedWith(
      "Signer already exists"
    );
  });

  it("Add signer - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).addSigner(firstUser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Remove signer -should work", async function () {
    //Add second user as a signer
    await ndContract.removeSigner(backend.address);

    //Should be reverted
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        1,
        await signAddress(backend, firstUser) //second user is not a signer
      )
    ).to.be.revertedWith("Invalid signature");
  });

  it("Remove signer - signer does not exist", async function () {
    //Remove second user as a signer
    await expect(
      ndContract.removeSigner(secondUser.address)
    ).to.be.revertedWith("Signer does not exist");
  });

  it("Add signer - not the owner", async function () {
    await expect(
      ndContract.connect(firstUser).removeSigner(firstUser.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Pause contract - should work", async function () {
    await ndContract.connect(owner).pause();
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        1,
        await signAddress(backend, firstUser)
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
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500,
        1,
        1,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Pausable: paused");

    await ndContract.connect(owner).unpause();

    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500,
      1,
      1,
      await signAddress(backend, firstUser)
    );
  });

  it("Unpause contract - not the owner", async function () {
    await ndContract.connect(owner).pause();
    await expect(ndContract.connect(firstUser).unpause()).to.be.revertedWith(
      "Ownable: caller is not the owner"
    );
  });

  it.skip("Buy all license ", async function () {
    // for gas test remove this function using "it.skip"
    //SETUP WORLD
    const signedMessage = await signAddress(backend, firstUser);

    //DO TEST
    for (let i = 1; i <= 12; i++) {
      expect(await ndContract.currentPriceTier()).to.equal(i);
      let tier = await ndContract._priceTiers(i);
      let units = tier.totalUnits.toNumber();
      do {
        if (units > maxUnits) {
          await buyLicenseWithMintAndAllowance(
            naeuraContract,
            ndContract,
            owner,
            firstUser,
            tier.usdPrice.toNumber() * maxUnits,
            maxUnits,
            i,
            signedMessage
          );
          units -= maxUnits;
        } else {
          await buyLicenseWithMintAndAllowance(
            naeuraContract,
            ndContract,
            owner,
            firstUser,
            tier.usdPrice.toNumber() * units,
            units,
            i,
            signedMessage
          );
          units -= units;
        }
      } while (units > 0);
    }

    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        20000,
        1,
        12,
        signedMessage
      )
    ).to.be.revertedWith("All licenses have been sold");
  });
});
