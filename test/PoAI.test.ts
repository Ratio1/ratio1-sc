import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, Signer } from "ethers";

describe.only("PoAIManager", function () {
  let poaiManager: Contract;
  let ndContract: Contract;
  let mndContract: Contract;
  let controller: Contract;
  let r1: Contract;
  let owner: Signer;
  let user: Signer;
  let oracle: Signer;
  let other: Signer;
  let snapshotId: string;
  let mockUsdc: Contract;
  let mockR1: Contract;
  let mockUniswapRouter: Contract;
  let mockUniswapPair: Contract;

  const START_EPOCH_TIMESTAMP = 1738767600;
  const ONE_DAY = 86400;

  beforeEach(async function () {
    [owner, user, oracle, other] = await ethers.getSigners();

    // Deploy R1 token
    const R1 = await ethers.getContractFactory("R1");
    r1 = await R1.deploy(await owner.getAddress());
    await r1.deployed();

    // Deploy Controller
    const Controller = await ethers.getContractFactory("Controller");
    controller = await Controller.deploy(
      START_EPOCH_TIMESTAMP,
      ONE_DAY,
      await owner.getAddress()
    );
    await controller.deployed();
    await controller.addOracle(await oracle.getAddress());

    // Deploy NDContract
    const NDContract = await ethers.getContractFactory("NDContract");
    ndContract = await upgrades.deployProxy(
      NDContract,
      [r1.address, controller.address, await owner.getAddress()],
      { initializer: "initialize" }
    );
    await ndContract.deployed();

    // Deploy MNDContract
    const MNDContract = await ethers.getContractFactory("MNDContract");
    mndContract = await upgrades.deployProxy(
      MNDContract,
      [r1.address, controller.address, await owner.getAddress()],
      { initializer: "initialize" }
    );
    await mndContract.deployed();

    // Set ND <-> MND relationship
    await ndContract.setMNDContract(mndContract.address);
    await mndContract.setNDContract(ndContract.address);

    // Deploy mock USDC and R1 tokens
    const MockERC20 = await ethers.getContractFactory("ERC20Mock");
    mockUsdc = await MockERC20.deploy();
    mockR1 = await MockERC20.deploy();

    // Deploy mock Uniswap router and pair
    const UniswapMockRouter = await ethers.getContractFactory(
      "UniswapMockRouter"
    );
    mockUniswapRouter = await UniswapMockRouter.deploy();
    await mockUniswapRouter.deployed();

    const UniswapMockPair = await ethers.getContractFactory("UniswapMockPair");
    mockUniswapPair = await UniswapMockPair.deploy(
      mockUsdc.address,
      mockR1.address
    );
    await mockUniswapPair.deployed();

    // Deploy CSP Escrow implementation
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrowImplementation = await CspEscrow.deploy();
    await cspEscrowImplementation.deployed();

    // Deploy PoAIManager
    const PoAIManager = await ethers.getContractFactory("PoAIManager");
    poaiManager = await upgrades.deployProxy(
      PoAIManager,
      [
        cspEscrowImplementation.address,
        ndContract.address,
        mndContract.address,
        controller.address,
        mockUsdc.address,
        mockR1.address,
        mockUniswapRouter.address,
        mockUniswapPair.address,
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.deployed();

    // Set timestamp to start epoch and mine a block
    const block = await ethers.provider.getBlock("latest");
    const nextTimestamp = Math.max(block.timestamp + 1, START_EPOCH_TIMESTAMP);
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);
    await ethers.provider.send("evm_mine", []);

    // Take snapshot for test isolation
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async function () {
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  // Helper for linkNode signature (matches MND test)
  async function signLinkNode(
    signer: Signer,
    user: Signer,
    nodeAddress: string
  ) {
    const messageHash = ethers.utils.solidityKeccak256(
      ["address", "address"],
      [await user.getAddress(), nodeAddress]
    );
    return signer.signMessage(ethers.utils.arrayify(messageHash));
  }

  // Helper function to setup user with MND license and linked oracle node
  async function setupUserWithOracleNode(
    userSigner: Signer,
    oracleSigner: Signer
  ) {
    // Add MND license to user
    const newTotalAssignedAmount = ethers.utils.parseEther("1000");
    await mndContract
      .connect(owner)
      .addLicense(await userSigner.getAddress(), newTotalAssignedAmount);

    // Link node to oracle address using MNDContract
    const licenseId = 2; // First non-genesis license minted
    const nodeAddress = await oracleSigner.getAddress();
    const linkSignature = await signLinkNode(
      oracleSigner,
      userSigner,
      nodeAddress
    );
    await mndContract
      .connect(userSigner)
      .linkNode(licenseId, nodeAddress, linkSignature);
  }

  // Helper function to setup user with escrow deployed
  async function setupUserWithEscrow(userSigner: Signer, oracleSigner: Signer) {
    await setupUserWithOracleNode(userSigner, oracleSigner);
    await poaiManager.connect(userSigner).deployCspEscrow();
    return await poaiManager.ownerToEscrow(await userSigner.getAddress());
  }

  it("should revert if user does not own an oracle node", async function () {
    await expect(
      poaiManager.connect(user).deployCspEscrow()
    ).to.be.revertedWith("No oracle node owned");
  });

  it("should deploy a new CSP Escrow for a user with an oracle node (MND path)", async function () {
    await setupUserWithOracleNode(user, oracle);

    // Now user has a node that is an oracle, should succeed
    expect(await poaiManager.connect(user).deployCspEscrow()).not.to.be
      .reverted;
  });

  it("should not allow double escrow deploy for the same user", async function () {
    await setupUserWithOracleNode(user, oracle);

    // First deploy should succeed
    await poaiManager.connect(user).deployCspEscrow();
    // Second deploy should revert
    await expect(
      poaiManager.connect(user).deployCspEscrow()
    ).to.be.revertedWith("Already has escrow");
  });

  it("should emit EscrowDeployed event with correct params", async function () {
    await setupUserWithOracleNode(user, oracle);

    await expect(await poaiManager.connect(user).deployCspEscrow())
      .to.emit(poaiManager, "EscrowDeployed")
      .withArgs(
        await user.getAddress(),
        await poaiManager.ownerToEscrow(await user.getAddress())
      );
  });

  it("should allow CSP owner to create a job", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow = CspEscrow.attach(escrowAddress);

    // Mint USDC to user and approve escrow
    const jobPrice = ethers.utils.parseEther("100");
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    // Create job
    const jobType = 1;
    const numberOfEpochs = 31; // Must be > 30
    const numberOfNodesRequested = 5;

    await expect(
      cspEscrow
        .connect(user)
        .createJob(jobType, jobPrice, numberOfEpochs, numberOfNodesRequested)
    )
      .to.emit(cspEscrow, "JobCreated")
      .withArgs(1, await user.getAddress(), jobType, jobPrice);

    // Verify job details
    const jobDetails = await cspEscrow.getJobDetails(1);
    expect(jobDetails.id).to.equal(1);
    expect(jobDetails.jobType).to.equal(jobType);
    expect(jobDetails.price).to.equal(jobPrice);
    expect(jobDetails.numberOfEpochs).to.equal(numberOfEpochs);
    expect(jobDetails.numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(jobDetails.startTimestamp).to.equal(0); // Not started yet

    // Verify USDC was transferred to escrow
    expect(await mockUsdc.balanceOf(escrowAddress)).to.equal(jobPrice);
  });

  it("should revert createJob with invalid parameters", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow = CspEscrow.attach(escrowAddress);

    // Mint USDC to user and approve escrow
    const jobPrice = ethers.utils.parseEther("100");
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    const jobType = 1;
    const numberOfEpochs = 31; // Must be > 30
    const numberOfNodesRequested = 5;

    // Test zero price
    await expect(
      cspEscrow
        .connect(user)
        .createJob(jobType, 0, numberOfEpochs, numberOfNodesRequested)
    ).to.be.revertedWith("Price must be greater than 0");

    // Test epochs <= 30
    await expect(
      cspEscrow
        .connect(user)
        .createJob(jobType, jobPrice, 30, numberOfNodesRequested)
    ).to.be.revertedWith("Number of epochs must be greater than 30");

    // Test zero nodes
    await expect(
      cspEscrow.connect(user).createJob(jobType, jobPrice, numberOfEpochs, 0)
    ).to.be.revertedWith("Number of nodes must be greater than 0");
  });

  it("should allow oracle to update active nodes and start job", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow = CspEscrow.attach(escrowAddress);

    // Mint USDC to user and approve escrow
    const jobPrice = ethers.utils.parseEther("100");
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    // Create job
    const jobType = 1;
    const numberOfEpochs = 31; // Must be > 30
    const numberOfNodesRequested = 5;

    await cspEscrow
      .connect(user)
      .createJob(jobType, jobPrice, numberOfEpochs, numberOfNodesRequested);

    // Verify job exists but start timestamp is 0
    const jobDetailsBefore = await cspEscrow.getJobDetails(1);
    expect(jobDetailsBefore.startTimestamp).to.equal(0);
    expect(jobDetailsBefore.activeNodes.length).to.equal(0);

    // Oracle updates active nodes
    const activeNodes = [await oracle.getAddress(), await other.getAddress()];
    const blockBeforeUpdate = await ethers.provider.getBlock("latest");

    await expect(cspEscrow.connect(oracle).updateActiveNodes(1, activeNodes))
      .to.emit(cspEscrow, "JobStarted")
      .withArgs(1, blockBeforeUpdate.timestamp + 1)
      .and.to.emit(cspEscrow, "NodesUpdated")
      .withArgs(1, activeNodes);

    // Verify job details updated
    const jobDetailsAfter = await cspEscrow.getJobDetails(1);
    expect(jobDetailsAfter.startTimestamp).to.equal(
      blockBeforeUpdate.timestamp + 1
    );
    expect(jobDetailsAfter.activeNodes).to.deep.equal(activeNodes);
  });

  it("should not allow non-oracle to update active nodes", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow = CspEscrow.attach(escrowAddress);

    // Mint USDC to user and approve escrow
    const jobPrice = ethers.utils.parseEther("100");
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    // Create job
    const jobType = 1;
    const numberOfEpochs = 31;
    const numberOfNodesRequested = 5;

    await cspEscrow
      .connect(user)
      .createJob(jobType, jobPrice, numberOfEpochs, numberOfNodesRequested);

    // Non-oracle tries to update active nodes
    const activeNodes = [await user.getAddress()];
    await expect(
      cspEscrow.connect(user).updateActiveNodes(1, activeNodes)
    ).to.be.revertedWith("Not an oracle");
  });
});
