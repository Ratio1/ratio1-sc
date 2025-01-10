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

const ONE_TOKEN = BigNumber.from(10).pow(18);
const ONE_DAY_IN_SECS = 24 * 60 * 60;
const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const USDC_ADDRESS = "0x6f14C02Fc1F78322cFd7d707aB90f18baD3B54f5";
const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const WRONG_SIGNATURE =
  "0bbb76f330fe36625b3c932055b5e7b5a7adb86b1e19c727cf21f8ada45299a97d35232bbc3205663b610ae2f3e2017eecc6ad62f7b22afa846762d666bb6ec81b";
const REWARDS_AMOUNT = BigNumber.from("17387705547524190242");
const COMPUTE_PARAMS = {
  licenseId: 1,
  nodeAddress: NODE_ADDRESS,
  epochs: [1, 2, 3, 4, 5],
  availabilies: [250, 130, 178, 12, 0],
};
const EXPECTED_COMPUTE_REWARDS_RESULT = {
  licenseId: BigNumber.from(1),
  rewardsAmount: REWARDS_AMOUNT,
};

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

  beforeEach(async function () {
    const [deployer, user1, user2, backendSigner] = await ethers.getSigners();
    owner = deployer;
    firstUser = user1;
    secondUser = user2;
    backend = backendSigner;

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
    await ndContract.setUsdcAddress(USDC_ADDRESS);

    await naeuraContract.setNdContract(ndContract.address);
    await naeuraContract.setMndContract(owner.address);
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
      signatureBytes[64] += 27; // Adjust recovery ID
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
    let result = await ndContract.ownerOf(1);
    expect(result).to.equal(firstUser.address);
  });

  it("Buy license - insufficent balance", async function () {
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        499,
        1,
        1,
        await signAddress(backend, firstUser)
      )
    ).to.be.revertedWith("Insufficient NAEURA balance");
  });

  it("Buy license - insufficent allowance", async function () {
    await naeuraContract
      .connect(owner)
      .mint(firstUser.address, ONE_TOKEN.mul(500));
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
      ndContract
        .connect(firstUser)
        .buyLicense(1, 1, Buffer.from(WRONG_SIGNATURE, "hex"))
    ).to.be.revertedWith("Invalid signature");
  });

  it("Buy license- change tier", async function () {
    //DO TEST - buy first 89 licenses
    expect(await ndContract.currentPriceTier()).to.equal(1);
    for (let i = 1; i <= 17; i++) {
      await buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        500 * 5,
        5,
        1,
        await signAddress(backend, firstUser)
      );
    }
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      500 * 4,
      4,
      1,
      await signAddress(backend, firstUser)
    );
    expect(await ndContract.currentPriceTier()).to.equal(2);

    //DO TEST -try buy 1 license in first tier
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
    ).to.be.revertedWith("Not in the right price tier");

    //DO TEST -buy 1 license in second tier
    await buyLicenseWithMintAndAllowance(
      naeuraContract,
      ndContract,
      owner,
      firstUser,
      750,
      1,
      2,
      await signAddress(backend, firstUser)
    );
    let result = await ndContract.ownerOf(90);
    expect(result).to.equal(firstUser.address);
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

  it("Claim rewards", async function () {
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
        [Buffer.from(await signComputeParams(backend), "hex")]
      );
    expect(await naeuraContract.balanceOf(firstUser.address)).to.equal(
      REWARDS_AMOUNT
    );
  });

  it.skip("Buy all license ", async function () {
    // for gas test remove this function using "it.skip"
    //SETUP WORLD
    const signedMessage = await signAddress(backend, firstUser);
    const maxUnits = 5; //TODO change with storage when updated (with maxUnits = 100 it could take up to 95s)

    //DO TEST
    await expect(
      buyLicenseWithMintAndAllowance(
        naeuraContract,
        ndContract,
        owner,
        firstUser,
        (await ndContract._priceTiers(1)).usdPrice.toNumber() * maxUnits + 1,
        maxUnits + 1,
        1,
        signedMessage
      )
    ).to.be.revertedWith("Invalid number of licenses");

    for (let i = 1; i <= 12; i++) {
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
