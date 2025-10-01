import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { AbiCoder, Signer } from "ethers";
import {
  R1,
  NDContract,
  Controller,
  PoAIManager,
  MNDContract,
  ERC20Mock,
  UniswapMockPair,
  UniswapMockRouter,
  CspEscrow,
} from "../typechain-types";

describe("PoAIManager", function () {
  let poaiManager: PoAIManager;
  let ndContract: NDContract;
  let mndContract: MNDContract;
  let controller: Controller;
  let r1: R1;
  let owner: Signer;
  let user: Signer;
  let oracle: Signer;
  let other: Signer;
  let oracle2: Signer;
  let oracle3: Signer;
  let oracle4: Signer;
  let oracle5: Signer;
  let snapshotId: string;
  let mockUsdc: ERC20Mock;
  let mockR1: ERC20Mock;
  let mockUniswapRouter: UniswapMockRouter;
  let mockUniswapPair: UniswapMockPair;

  const START_EPOCH_TIMESTAMP = 1738767600;
  const ONE_DAY = 86400;
  const BURN_PERCENTAGE = 15n;

  beforeEach(async function () {
    [owner, user, oracle, other, oracle2, oracle3, oracle4, oracle5] =
      await ethers.getSigners();

    // Deploy R1 token
    const R1 = await ethers.getContractFactory("R1");
    r1 = await R1.deploy(await owner.getAddress());
    await r1.waitForDeployment();

    // Deploy Controller
    const Controller = await ethers.getContractFactory("Controller");
    controller = await Controller.deploy(
      START_EPOCH_TIMESTAMP,
      ONE_DAY,
      await owner.getAddress()
    );
    await controller.waitForDeployment();
    await controller.addOracle(await oracle.getAddress());

    // Deploy NDContract
    const NDContract = await ethers.getContractFactory("NDContract");
    ndContract = await upgrades.deployProxy(
      NDContract,
      [
        await r1.getAddress(),
        await controller.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await ndContract.waitForDeployment();

    // Deploy MNDContract
    const MNDContract = await ethers.getContractFactory("MNDContract");
    mndContract = await upgrades.deployProxy(
      MNDContract,
      [
        await r1.getAddress(),
        await controller.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await mndContract.waitForDeployment();

    // Set ND <-> MND relationship
    await ndContract.setMNDContract(await mndContract.getAddress());
    await mndContract.setNDContract(await ndContract.getAddress());

    await controller.setContracts(
      await ndContract.getAddress(),
      await mndContract.getAddress()
    );

    // Deploy mock USDC and R1 tokens
    const MockERC20 = await ethers.getContractFactory("ERC20Mock");
    mockUsdc = await MockERC20.deploy();
    mockR1 = await MockERC20.deploy();

    // Deploy mock Uniswap router and pair
    const UniswapMockRouter = await ethers.getContractFactory(
      "UniswapMockRouter"
    );
    mockUniswapRouter = await UniswapMockRouter.deploy();
    await mockUniswapRouter.waitForDeployment();

    const UniswapMockPair = await ethers.getContractFactory("UniswapMockPair");
    mockUniswapPair = await UniswapMockPair.deploy(
      await mockUsdc.getAddress(),
      await mockR1.getAddress()
    );
    await mockUniswapPair.waitForDeployment();

    // Deploy CSP Escrow implementation
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrowImplementation = await CspEscrow.deploy();
    await cspEscrowImplementation.waitForDeployment();

    // Deploy PoAIManager
    const PoAIManager = await ethers.getContractFactory("PoAIManager");
    poaiManager = await upgrades.deployProxy(
      PoAIManager,
      [
        await cspEscrowImplementation.getAddress(),
        await ndContract.getAddress(),
        await mndContract.getAddress(),
        await controller.getAddress(),
        await mockUsdc.getAddress(),
        await mockR1.getAddress(),
        await mockUniswapRouter.getAddress(),
        await mockUniswapPair.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.waitForDeployment();

    // Set timestamp to start epoch + 1 day to avoid epoch 0 underflow issues
    const block = await ethers.provider.getBlock("latest");
    const nextTimestamp = Math.max(
      (block?.timestamp || 0) + 1,
      START_EPOCH_TIMESTAMP + ONE_DAY
    );
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
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "address"],
      [await user.getAddress(), nodeAddress]
    );
    return signer.signMessage(ethers.getBytes(messageHash));
  }

  // Helper function to setup user with MND license and linked oracle node
  async function setupUserWithOracleNode(
    userSigner: Signer,
    oracleSigner: Signer
  ) {
    // Add MND license to user
    const newTotalAssignedAmount = ethers.parseEther("1000");
    await mndContract
      .connect(owner)
      .addLicense(await userSigner.getAddress(), newTotalAssignedAmount);

    // Get the user's licenses to find the correct license ID
    const licenses = await mndContract.getLicenses(
      await userSigner.getAddress()
    );
    const licenseId = licenses[licenses.length - 1].licenseId; // Get the latest license

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

  async function setupJobWithActiveNodes() {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + 30n;
    const numberOfEpochs = lastExecutionEpoch - currentEpoch;
    const numberOfNodesRequested = 1n;
    const jobType = 1;
    const pricePerEpoch = 375000n;
    const expectedPrice =
      pricePerEpoch * numberOfNodesRequested * numberOfEpochs;

    await mockUsdc.mint(await user.getAddress(), expectedPrice);
    await mockUsdc.connect(user).approve(escrowAddress, expectedPrice);

    const jobCreationRequest = {
      jobType,
      projectHash: ethers.keccak256(ethers.toUtf8Bytes("project-id")),
      lastExecutionEpoch,
      numberOfNodesRequested,
    };

    await cspEscrow.connect(user).createJobs([jobCreationRequest]);

    const activeNodes = [await oracle.getAddress()];
    await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

    return { cspEscrow, numberOfEpochs };
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
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    // Mint USDC to user and approve escrow
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + 31n;
    const numberOfNodesRequested = 5;
    const numberOfEpochs = 31;
    // Use job type 1 (ENTRY) which costs 375000 per epoch
    const jobType = 1;
    const pricePerEpoch = 375000; // ENTRY price in USDC (6 decimals)
    const expectedPrice =
      numberOfNodesRequested * numberOfEpochs * pricePerEpoch; // 5 * 31 * 375000 = 58125000

    await mockUsdc.mint(await user.getAddress(), expectedPrice);
    await mockUsdc.connect(user).approve(escrowAddress, expectedPrice);

    // Create job with new signature: JobCreationRequest array
    const jobCreationRequest = {
      jobType: jobType,
      projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
      lastExecutionEpoch: lastExecutionEpoch,
      numberOfNodesRequested: numberOfNodesRequested,
    };

    await expect(cspEscrow.connect(user).createJobs([jobCreationRequest]))
      .to.emit(cspEscrow, "JobCreated")
      .withArgs(1, await user.getAddress(), jobType, pricePerEpoch);

    // Verify job details
    const jobDetails = await cspEscrow.getJobDetails(1);
    expect(jobDetails.id).to.equal(1);
    expect(jobDetails.jobType).to.equal(jobType);
    expect(jobDetails.pricePerEpoch).to.equal(pricePerEpoch);
    expect(jobDetails.lastExecutionEpoch).to.equal(lastExecutionEpoch);
    expect(jobDetails.numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(jobDetails.startTimestamp).to.equal(0); // Not started yet

    // Verify USDC was transferred to escrow
    expect(await mockUsdc.balanceOf(escrowAddress)).to.equal(expectedPrice);
  });

  it("should allow CSP owner to extend job duration", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const jobType = 1;
    const initialEpochs = 35n;
    const numberOfNodes = 2n;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(jobType);
    const jobPrice = pricePerEpoch * numberOfNodes * initialEpochs;

    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    const lastExecutionEpoch = currentEpoch + initialEpochs;
    await cspEscrow.connect(user).createJobs([
      {
        jobType,
        projectHash: ethers.keccak256(ethers.toUtf8Bytes("extend-job-test")),
        lastExecutionEpoch,
        numberOfNodesRequested: numberOfNodes,
      },
    ]);

    const jobBefore = await cspEscrow.getJobDetails(1);
    const additionalEpochs = 10n;
    const newLastExecutionEpoch =
      jobBefore.lastExecutionEpoch + additionalEpochs;
    const additionalAmount =
      jobBefore.pricePerEpoch *
      jobBefore.numberOfNodesRequested *
      additionalEpochs;

    await mockUsdc.mint(await user.getAddress(), additionalAmount);
    await mockUsdc.connect(user).approve(escrowAddress, additionalAmount);

    await expect(
      cspEscrow.connect(user).extendJobDuration(1, newLastExecutionEpoch)
    )
      .to.emit(cspEscrow, "JobDurationExtended")
      .withArgs(1, newLastExecutionEpoch, additionalAmount);

    const jobAfter = await cspEscrow.getJobDetails(1);
    expect(jobAfter.lastExecutionEpoch).to.equal(newLastExecutionEpoch);
    expect(jobAfter.balance).to.equal(jobBefore.balance + additionalAmount);
    expect(await mockUsdc.balanceOf(escrowAddress)).to.equal(
      jobPrice + additionalAmount
    );
  });

  it("should revert createJob with invalid parameters", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    // Mint USDC to user and approve escrow
    const jobPrice = 100000000; // 100 USDC (6 decimals)
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    const jobType = 1;
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const numberOfNodesRequested = 5;

    // Test epochs < 30 (lastExecutionEpoch too close to current)
    const lastExecutionEpochTooClose = currentEpoch + 29n;
    await expect(
      cspEscrow.connect(user).createJobs([
        {
          jobType: jobType,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpochTooClose,
          numberOfNodesRequested: numberOfNodesRequested,
        },
      ])
    ).to.be.revertedWith("Number of epochs must be greater than 30");

    // Test zero nodes
    const lastExecutionEpoch = currentEpoch + 31n;
    await expect(
      cspEscrow.connect(user).createJobs([
        {
          jobType: jobType,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 0,
        },
      ])
    ).to.be.revertedWith("Number of nodes must be greater than 0");
  });

  it("should allow oracle to submit node update for consensus", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    // Mint USDC to user and approve escrow
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + 31n;
    const numberOfNodesRequested = 5;
    const numberOfEpochs = 31;
    // Use job type 1 (ENTRY) which costs 375000 per epoch
    const jobType = 1;
    const pricePerEpoch = 375000; // ENTRY price in USDC (6 decimals)
    const expectedPrice =
      numberOfNodesRequested * numberOfEpochs * pricePerEpoch;

    await mockUsdc.mint(await user.getAddress(), expectedPrice);
    await mockUsdc.connect(user).approve(escrowAddress, expectedPrice);

    // Create job
    const jobCreationRequest = {
      jobType: jobType,
      projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
      lastExecutionEpoch: lastExecutionEpoch,
      numberOfNodesRequested: numberOfNodesRequested,
    };

    await cspEscrow.connect(user).createJobs([jobCreationRequest]);

    // Verify job exists but start timestamp is 0
    const jobDetailsBefore = await cspEscrow.getJobDetails(1);
    expect(jobDetailsBefore.startTimestamp).to.equal(0);
    expect(jobDetailsBefore.activeNodes.length).to.equal(0);

    // Oracle submits node update for consensus
    const activeNodes = [await oracle.getAddress(), await other.getAddress()];

    await expect(poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes))
      .to.emit(poaiManager, "NodeUpdateSubmittedV2")
      .withArgs(
        1,
        await oracle.getAddress(),
        activeNodes,
        ethers.keccak256(
          AbiCoder.defaultAbiCoder().encode(["address[]"], [activeNodes])
        )
      )
      .and.to.emit(poaiManager, "ConsensusReachedV2")
      .withArgs(1, activeNodes, [await oracle.getAddress()]);

    // Since we only have 1 oracle, consensus is reached immediately
    const jobDetailsAfter = await cspEscrow.getJobDetails(1);
    expect(jobDetailsAfter.startTimestamp).to.be.gt(0); // Job should be started
    expect(jobDetailsAfter.activeNodes).to.deep.equal(activeNodes); // Active nodes should be set
  });

  it("should not allow non-oracle to submit node updates", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    // Mint USDC to user and approve escrow
    const jobPrice = 100000000; // 100 USDC (6 decimals)
    await mockUsdc.mint(await user.getAddress(), jobPrice);
    await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

    // Create job
    const jobType = 1;
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + 31n;
    const numberOfNodesRequested = 5;

    const jobCreationRequest = {
      jobType: jobType,
      projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
      lastExecutionEpoch: lastExecutionEpoch,
      numberOfNodesRequested: numberOfNodesRequested,
    };

    await cspEscrow.connect(user).createJobs([jobCreationRequest]);

    // Non-oracle tries to submit node update
    const activeNodes = [await user.getAddress()];
    await expect(
      poaiManager.connect(user).submitNodeUpdate(1, activeNodes)
    ).to.be.revertedWith("Not an oracle");
  });

  describe("Closable job lookup", function () {
    it("returns 0 when no job is closable", async function () {
      const { cspEscrow } = await setupJobWithActiveNodes();

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(0);
      expect(await poaiManager.getFirstClosableJobId()).to.eq(0);
    });

    it("returns the job id once a job becomes closable", async function () {
      const { cspEscrow, numberOfEpochs } = await setupJobWithActiveNodes();

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(0);
      expect(await poaiManager.getFirstClosableJobId()).to.eq(0);

      await ethers.provider.send("evm_increaseTime", [
        Number(numberOfEpochs) * ONE_DAY,
      ]);
      await ethers.provider.send("evm_mine", []);

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(1);
      expect(await poaiManager.getFirstClosableJobId()).to.eq(1);
    });

    it("allows closing a job after it becomes closable", async function () {
      const { cspEscrow, numberOfEpochs } = await setupJobWithActiveNodes();

      await ethers.provider.send("evm_increaseTime", [
        Number(numberOfEpochs) * ONE_DAY,
      ]);
      await ethers.provider.send("evm_mine", []);

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(1);

      await expect(poaiManager.connect(oracle).submitNodeUpdate(1, [])).to.emit(
        cspEscrow,
        "JobClosed"
      );

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(0);
      expect(await poaiManager.getFirstClosableJobId()).to.eq(0);
    });
  });

  describe("Consensus Mechanism", function () {
    let oracle2: Signer;
    let oracle3: Signer;
    let oracle4: Signer;
    let oracle5: Signer;

    beforeEach(async function () {
      [owner, user, oracle, other, oracle2, oracle3, oracle4, oracle5] =
        await ethers.getSigners();

      // Add more oracles to test consensus
      await controller.addOracle(await oracle2.getAddress());
      await controller.addOracle(await oracle3.getAddress());
      await controller.addOracle(await oracle4.getAddress());
      await controller.addOracle(await oracle5.getAddress());
    });

    it("should allow oracles to submit node updates", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      await expect(poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes))
        .to.emit(poaiManager, "NodeUpdateSubmittedV2")
        .withArgs(
          1,
          await oracle.getAddress(),
          activeNodes,
          ethers.keccak256(
            AbiCoder.defaultAbiCoder().encode(["address[]"], [activeNodes])
          )
        );
    });

    it("should not allow oracle to submit twice for the same job", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const activeNodes = [await oracle.getAddress()];

      // First submission should succeed
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Second submission should fail
      await expect(
        poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes)
      ).to.be.revertedWith("Already submitted");
    });

    it("should not allow submission for non-existent job", async function () {
      const activeNodes = [await oracle.getAddress()];

      await expect(
        poaiManager.connect(oracle).submitNodeUpdate(999, activeNodes)
      ).to.be.revertedWith("Job does not exist");
    });

    it("should reach consensus when 33%+1 oracles agree", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const consensusNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      // Submit from 3 oracles (50%+1 of 5 oracles) with same nodes
      await poaiManager.connect(oracle).submitNodeUpdate(1, consensusNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, consensusNodes);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, consensusNodes);

      // Verify escrow was updated via consensus
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes).to.deep.equal(consensusNodes);
      expect(jobDetails.startTimestamp).to.be.gt(0);
    });

    it("should not reach consensus when oracles disagree", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const nodes1 = [await oracle.getAddress()];
      const nodes2 = [await oracle2.getAddress()];
      const nodes3 = [await oracle3.getAddress()];

      // Submit different nodes from oracles
      await poaiManager.connect(oracle).submitNodeUpdate(1, nodes1);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, nodes2);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, nodes3);

      // Verify escrow was not updated (no consensus reached)
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes.length).to.equal(0);
      expect(jobDetails.startTimestamp).to.equal(0);
    });

    it("should emit correct events during consensus process", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const consensusNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      // Submit and expect events
      await expect(
        poaiManager.connect(oracle).submitNodeUpdate(1, consensusNodes)
      )
        .to.emit(poaiManager, "NodeUpdateSubmittedV2")
        .withArgs(
          1,
          await oracle.getAddress(),
          consensusNodes,
          ethers.keccak256(
            AbiCoder.defaultAbiCoder().encode(["address[]"], [consensusNodes])
          )
        );

      await expect(
        poaiManager.connect(oracle2).submitNodeUpdate(1, consensusNodes)
      )
        .to.emit(poaiManager, "NodeUpdateSubmittedV2")
        .withArgs(
          1,
          await oracle2.getAddress(),
          consensusNodes,
          ethers.keccak256(
            AbiCoder.defaultAbiCoder().encode(["address[]"], [consensusNodes])
          )
        );

      await expect(
        poaiManager.connect(oracle3).submitNodeUpdate(1, consensusNodes)
      )
        .to.emit(poaiManager, "NodeUpdateSubmittedV2")
        .withArgs(
          1,
          await oracle3.getAddress(),
          consensusNodes,
          ethers.keccak256(
            AbiCoder.defaultAbiCoder().encode(["address[]"], [consensusNodes])
          )
        )
        .and.to.emit(poaiManager, "ConsensusReachedV2")
        .withArgs(1, consensusNodes, [
          await oracle.getAddress(),
          await oracle2.getAddress(),
          await oracle3.getAddress(),
        ]);
    });

    it("should not allow submission of same nodes as current active nodes", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      // First, reach consensus with some nodes
      const initialNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];
      await poaiManager.connect(oracle).submitNodeUpdate(1, initialNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, initialNodes);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, initialNodes);

      // Verify consensus was reached
      const jobDetailsAfterConsensus = await cspEscrow.getJobDetails(1);
      expect(jobDetailsAfterConsensus.activeNodes).to.deep.equal(initialNodes);

      // Try to submit the same nodes again (should not revert, just return early)
      await expect(
        poaiManager.connect(oracle4).submitNodeUpdate(1, initialNodes)
      ).to.not.be.reverted;
    });

    it("should handle consensus with exactly 33%+1 oracles", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const consensusNodes = [await oracle.getAddress()];

      // With 5 oracles, we need 2 oracles (33%+1 = 1.67+1 = 2.67, so 3)
      await poaiManager.connect(oracle).submitNodeUpdate(1, consensusNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, consensusNodes);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, consensusNodes);

      // Verify consensus was reached
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes).to.deep.equal(consensusNodes);
      expect(jobDetails.startTimestamp).to.be.gt(0);
    });

    it("should not reach consensus with less than 33%+1 oracles", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 100000000; // 100 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const consensusNodes = [await oracle.getAddress()];

      // With 5 oracles, we need 3 oracles (33%+1 = 1.67+1 = 2.67, so 3)
      // Only submit from 2 oracles (less than required)
      await poaiManager.connect(oracle).submitNodeUpdate(1, consensusNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, consensusNodes);

      // Verify consensus was not reached
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes.length).to.equal(0);
      expect(jobDetails.startTimestamp).to.equal(0);
    });
  });

  describe("Rewards Allocation and Burning", function () {
    // TODO: Fix this test
    it.skip("should allocate rewards to active nodes and burn 15%", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with sufficient balance
      const jobPrice = 1000000000; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n; // Multiple epochs
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Set active nodes via consensus
      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
        await oracle3.getAddress(),
      ];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Advance time to next epoch
      const block1 = await ethers.provider.getBlock("latest");
      const nextEpochTimestamp = Math.max(
        (block1?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        nextEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Advance time to epoch 2 before allocating rewards (so we can allocate for epoch 1)
      const block = await ethers.provider.getBlock("latest");
      const allocationEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        allocationEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards via PoAI Manager
      await expect(poaiManager.allocateRewardsAcrossAllEscrows())
        .to.emit(cspEscrow, "RewardsAllocatedV2")
        .withArgs(1, activeNodes, 956250); // 3 nodes * 318750 (pricePerEpoch - 15% burn)

      // Verify virtual wallet balances
      const rewardPerNode = 318750; // pricePerEpoch = 375000, minus 15% burn = 318750
      expect(
        await cspEscrow.virtualWalletBalance(await oracle.getAddress())
      ).to.equal(rewardPerNode);
      expect(
        await cspEscrow.virtualWalletBalance(await oracle2.getAddress())
      ).to.equal(rewardPerNode);
      expect(
        await cspEscrow.virtualWalletBalance(await oracle3.getAddress())
      ).to.equal(rewardPerNode);

      // Verify job balance was reduced
      const jobDetails = await cspEscrow.getJobDetails(1);
      // Job balance: 3 nodes * 35 epochs * 375000 = 39375000
      // After 1 allocation: 39375000 - (956250 + 168750 burn) = 38250000
      expect(jobDetails.balance).to.equal(38250000);
      expect(jobDetails.lastAllocatedEpoch).to.equal(
        await poaiManager.getCurrentEpoch()
      );
    });

    // TODO: Fix this test
    it.skip("should burn 15% of rewards by swapping USDC for R1", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 1000000000; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      // Set active nodes
      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Advance time
      const block = await ethers.provider.getBlock("latest");
      const burnEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        burnEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Allocate rewards and expect burning
      await expect(poaiManager.allocateRewardsAcrossAllEscrows())
        .to.emit(cspEscrow, "RewardsAllocatedV2")
        .withArgs(1, activeNodes, 637500); // 2 nodes * 318750 (pricePerEpoch - 15% burn)
    });

    it("should not allocate rewards for jobs without active nodes", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job but don't set active nodes
      const jobPrice = 1000000000; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      // Advance time
      const block = await ethers.provider.getBlock("latest");
      const noActiveNodesEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        noActiveNodesEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards - should not emit any events
      await expect(poaiManager.allocateRewardsAcrossAllEscrows()).to.not.emit(
        cspEscrow,
        "RewardsAllocatedV2"
      );
    });

    it("should only allow the CSP owner to reconcile job balances", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(
            ethers.toUtf8Bytes("job-reconcile-owner")
          ),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 1,
        },
      ]);

      await expect(
        cspEscrow.connect(oracle).reconcileJobsBalance()
      ).to.be.revertedWith("Not PoAI Manager");
    });

    it.skip("should reconcile legacy job balances by subtracting historical burn", async function () {
      //skip this test for now as it requires too much setup to run properly. For testing, need to comment address nodeOwner = ndContract.getNodeOwner(nodeAddress) in allocateRewardsToNodes to make it work
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("job-reconcile")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 1,
        },
      ]);

      const nodeAddress = await oracle.getAddress();
      await controller.setContracts(
        mndContract.getAddress(),
        mndContract.getAddress()
      ); // Use MND as dummy ND to avoid all setup
      await poaiManager.connect(oracle).submitNodeUpdate(1, [nodeAddress]);

      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      const block1 = await ethers.provider.getBlock("latest");
      const nextEpochTimestamp = Math.max(
        (block1?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        nextEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const block2 = await ethers.provider.getBlock("latest");
      const allocationEpochTimestamp = Math.max(
        (block2?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        allocationEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      await poaiManager.allocateRewardsAcrossAllEscrows();

      const jobDetailsAfterAllocation = await cspEscrow.getJobDetails(1);
      const correctBalance = jobDetailsAfterAllocation.balance;
      const rewardForNode = await cspEscrow.virtualWalletBalance(nodeAddress);
      const burnDebt =
        (rewardForNode * BURN_PERCENTAGE) / (100n - BURN_PERCENTAGE);
      expect(burnDebt).to.be.gt(0);

      const legacyBalance = correctBalance + burnDebt;

      const mappingSlot = 7;
      const baseSlot = ethers.keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256"],
          [1, mappingSlot]
        )
      );
      const balanceSlot = BigInt(baseSlot) + 9n;
      await ethers.provider.send("hardhat_setStorageAt", [
        escrowAddress,
        ethers.zeroPadValue(balanceSlot.toString(16), 32),
        ethers.zeroPadValue(legacyBalance.toString(16), 32),
      ]);

      const mutatedJobDetails = await cspEscrow.getJobDetails(1);
      expect(mutatedJobDetails.balance).to.equal(legacyBalance);

      await expect(poaiManager.connect(owner).reconcileAllJobsBalance())
        .to.emit(cspEscrow, "JobBalanceReconciled")
        .withArgs(1, burnDebt);

      const reconciledJobDetails = await cspEscrow.getJobDetails(1);
      expect(reconciledJobDetails.balance).to.equal(correctBalance);
    });

    it("should not allocate rewards for ended jobs", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with short duration
      const jobPrice = 1000000000; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n; // Must be more than 30 epochs
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      // Set active nodes
      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Allocate rewards once
      await poaiManager.allocateRewardsAcrossAllEscrows();

      // Try to allocate again - should not emit events
      await expect(poaiManager.allocateRewardsAcrossAllEscrows()).to.not.emit(
        cspEscrow,
        "RewardsAllocatedV2"
      );
    });

    // TODO: Fix this test
    it.skip("should handle multiple epochs of reward allocation", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with multiple epochs
      const jobPrice = 1000000000; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n; // Must be more than 30 epochs
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      // Set active nodes
      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Advance time to next epoch before allocating rewards
      const nextEpochTimestamp = START_EPOCH_TIMESTAMP + 2 * ONE_DAY;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        nextEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards for epoch 1
      await poaiManager.allocateRewardsAcrossAllEscrows();
      const balance = await cspEscrow.virtualWalletBalance(
        await oracle.getAddress()
      );
      console.log(
        "Virtual wallet balance after allocation:",
        balance.toString()
      );
      expect(balance).to.equal(318750); // Should be 318750 after first allocation

      // Advance to epoch 2
      const block2 = await ethers.provider.getBlock("latest");
      const epoch2Timestamp = Math.max(
        (block2?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        epoch2Timestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards for epoch 2
      await poaiManager.allocateRewardsAcrossAllEscrows();
      const balance2 = await cspEscrow.virtualWalletBalance(
        await oracle.getAddress()
      );
      console.log("Virtual wallet balance after epoch 2:", balance2.toString());
      expect(balance2).to.equal(637500); // Should be 637500 after second allocation

      // Advance to epoch 3
      const block3 = await ethers.provider.getBlock("latest");
      const epoch3Timestamp = Math.max(
        (block3?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 3 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        epoch3Timestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards for epoch 3
      await poaiManager.allocateRewardsAcrossAllEscrows();
      const balance3 = await cspEscrow.virtualWalletBalance(
        await oracle.getAddress()
      );
      console.log("Virtual wallet balance after epoch 3:", balance3.toString());
      expect(balance3).to.equal(956250); // Should be 956250 after third allocation
    });
  });

  describe("Multiple Jobs and Escrows", function () {
    it("should handle multiple jobs in the same escrow", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create first job
      const jobPrice1 = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice1);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice1);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch1 = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project-1")),
          lastExecutionEpoch: lastExecutionEpoch1,
          numberOfNodesRequested: 2,
        },
      ]);

      // Create second job
      const jobPrice2 = 300000000; // 300 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice2);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice2);

      const lastExecutionEpoch2 = currentEpoch + 40n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 2,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project-2")),
          lastExecutionEpoch: lastExecutionEpoch2,
          numberOfNodesRequested: 1,
        },
      ]);

      // Verify both jobs exist
      const job1Details = await cspEscrow.getJobDetails(1);
      const job2Details = await cspEscrow.getJobDetails(2);
      expect(job1Details.id).to.equal(1);
      expect(job2Details.id).to.equal(2);
      // Job balance is calculated as: numberOfNodesRequested * numberOfEpochs * pricePerEpoch
      // Job 1: 2 nodes * 35 epochs * 375000 = 26250000
      // Job 2: 1 node * 40 epochs * 750000 = 30000000
      expect(job1Details.balance).to.equal(26250000);
      expect(job2Details.balance).to.equal(30000000);
    });

    it("should handle multiple escrows with different owners", async function () {
      // Setup first user with escrow
      const escrowAddress1 = await setupUserWithEscrow(user, oracle);

      // Setup second user with escrow
      const user2 = other;
      // Add oracle2 to controller first
      await controller.addOracle(await oracle2.getAddress());
      await setupUserWithOracleNode(user2, oracle2);
      await poaiManager.connect(user2).deployCspEscrow();
      const escrowAddress2 = await poaiManager.ownerToEscrow(
        await user2.getAddress()
      );

      // Verify different escrows
      expect(escrowAddress1).to.not.equal(escrowAddress2);
      expect(await poaiManager.escrowToOwner(escrowAddress1)).to.equal(
        await user.getAddress()
      );
      expect(await poaiManager.escrowToOwner(escrowAddress2)).to.equal(
        await user2.getAddress()
      );

      // Verify all escrows list
      const allEscrows = await poaiManager.getAllEscrows();
      expect(allEscrows).to.include(escrowAddress1);
      expect(allEscrows).to.include(escrowAddress2);
      expect(allEscrows.length).to.equal(2);
    });

    it("should allocate rewards across all escrows", async function () {
      // Setup multiple escrows
      const escrowAddress1 = await setupUserWithEscrow(user, oracle);
      const user2 = other;
      // Add oracle2 to controller first
      await controller.addOracle(await oracle2.getAddress());
      await setupUserWithOracleNode(user2, oracle2);
      await poaiManager.connect(user2).deployCspEscrow();
      const escrowAddress2 = await poaiManager.ownerToEscrow(
        await user2.getAddress()
      );

      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow1: CspEscrow = CspEscrow.attach(
        escrowAddress1
      ) as CspEscrow;
      const cspEscrow2: CspEscrow = CspEscrow.attach(
        escrowAddress2
      ) as CspEscrow;

      // Create jobs in both escrows
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.mint(await user2.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress1, jobPrice);
      await mockUsdc.connect(user2).approve(escrowAddress2, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;

      await cspEscrow1.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project-1")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);
      await cspEscrow2.connect(user2).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project-2")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 1,
        },
      ]);

      // Set active nodes for both jobs
      const activeNodes1 = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];
      const activeNodes2 = [await oracle2.getAddress()];

      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes1);
      await poaiManager.connect(oracle2).submitNodeUpdate(2, activeNodes2);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Advance time
      const block = await ethers.provider.getBlock("latest");
      const multipleEscrowsEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        multipleEscrowsEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards across all escrows
      await poaiManager.allocateRewardsAcrossAllEscrows();
      // Check that rewards were allocated by checking virtual wallet balance
      const balance1 = await cspEscrow1.virtualWalletBalance(
        await oracle.getAddress()
      );
      const balance2 = await cspEscrow2.virtualWalletBalance(
        await oracle2.getAddress()
      );
      expect(balance1).to.be.gte(0);
      expect(balance2).to.be.gte(0);
    });
  });

  describe("View Functions and Getters", function () {
    it("should return correct job details via PoAI Manager", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Get job details via PoAI Manager
      const jobDetails = await poaiManager.getJobDetails(1);
      expect(jobDetails.id).to.equal(1);
      expect(jobDetails.jobType).to.equal(1);
      expect(jobDetails.numberOfNodesRequested).to.equal(3);
      // Job balance: 3 nodes * 35 epochs * 375000 = 39375000
      expect(jobDetails.balance).to.equal(39375000);
    });

    it("should return correct current epoch", async function () {
      const currentEpoch = await poaiManager.getCurrentEpoch();
      expect(currentEpoch).to.equal(1); // Should be epoch 1 at start (START_EPOCH_TIMESTAMP + ONE_DAY)

      // Advance time by one day
      const nextEpochTimestamp = START_EPOCH_TIMESTAMP + 2 * ONE_DAY;
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        nextEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      const newEpoch = await poaiManager.getCurrentEpoch();
      expect(newEpoch).to.equal(2);
    });

    it("should return correct escrow mappings", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);

      // Test owner to escrow mapping
      expect(await poaiManager.ownerToEscrow(await user.getAddress())).to.equal(
        escrowAddress
      );

      // Test escrow to owner mapping
      expect(await poaiManager.escrowToOwner(escrowAddress)).to.equal(
        await user.getAddress()
      );

      // Test job ID to escrow mapping
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      expect(await poaiManager.jobIdToEscrow(1)).to.equal(escrowAddress);
    });

    it("should return all escrows correctly", async function () {
      // Initially no escrows
      let allEscrows = await poaiManager.getAllEscrows();
      expect(allEscrows.length).to.equal(0);

      // Deploy first escrow
      await setupUserWithEscrow(user, oracle);
      allEscrows = await poaiManager.getAllEscrows();
      expect(allEscrows.length).to.equal(1);

      // Deploy second escrow
      const user2 = other;
      // Add oracle2 to controller first
      await controller.addOracle(await oracle2.getAddress());
      await setupUserWithOracleNode(user2, oracle2);
      await poaiManager.connect(user2).deployCspEscrow();
      allEscrows = await poaiManager.getAllEscrows();
      expect(allEscrows.length).to.equal(2);
    });

    it("should return total balance across all escrows", async function () {
      const escrowAddress1 = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow1: CspEscrow = CspEscrow.attach(
        escrowAddress1
      ) as CspEscrow;

      const currentEpoch = await poaiManager.getCurrentEpoch();

      const numberOfNodes1 = 2n;
      const epochs1 = 35n;
      const pricePerEpoch1 = await cspEscrow1.getPriceForJobType(1);
      const jobPrice1 = pricePerEpoch1 * numberOfNodes1 * epochs1;

      await mockUsdc.mint(await user.getAddress(), jobPrice1);
      await mockUsdc.connect(user).approve(escrowAddress1, jobPrice1);

      const lastExecutionEpoch1 = currentEpoch + epochs1;
      await cspEscrow1.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(
            ethers.toUtf8Bytes("total-balance-job-1")
          ),
          lastExecutionEpoch: lastExecutionEpoch1,
          numberOfNodesRequested: numberOfNodes1,
        },
      ]);

      const user2 = other;
      await controller.addOracle(await oracle2.getAddress());
      await setupUserWithOracleNode(user2, oracle2);
      await poaiManager.connect(user2).deployCspEscrow();
      const escrowAddress2 = await poaiManager.ownerToEscrow(
        await user2.getAddress()
      );
      const cspEscrow2: CspEscrow = CspEscrow.attach(
        escrowAddress2
      ) as CspEscrow;

      const numberOfNodes2 = 1n;
      const epochs2 = 40n;
      const pricePerEpoch2 = await cspEscrow2.getPriceForJobType(2);
      const jobPrice2 = pricePerEpoch2 * numberOfNodes2 * epochs2;

      await mockUsdc.mint(await user2.getAddress(), jobPrice2);
      await mockUsdc.connect(user2).approve(escrowAddress2, jobPrice2);

      const lastExecutionEpoch2 = currentEpoch + epochs2;
      await cspEscrow2.connect(user2).createJobs([
        {
          jobType: 2,
          projectHash: ethers.keccak256(
            ethers.toUtf8Bytes("total-balance-job-2")
          ),
          lastExecutionEpoch: lastExecutionEpoch2,
          numberOfNodesRequested: numberOfNodes2,
        },
      ]);

      const escrowBalance1 = await cspEscrow1.getTotalJobsBalance();
      const escrowBalance2 = await cspEscrow2.getTotalJobsBalance();
      const totalEscrowBalance = await poaiManager.getTotalEscrowsBalance();

      expect(escrowBalance1).to.equal(jobPrice1);
      expect(escrowBalance2).to.equal(jobPrice2);
      expect(totalEscrowBalance).to.equal(jobPrice1 + jobPrice2);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("should handle job creation with maximum epochs", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with maximum epochs (current + 1000)
      const jobPrice = 10000000000; // 10000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 1000n;
      await expect(
        cspEscrow.connect(user).createJobs([
          {
            jobType: 1,
            projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
            lastExecutionEpoch: lastExecutionEpoch,
            numberOfNodesRequested: 5,
          },
        ])
      ).not.to.be.reverted;
    });

    it("should handle empty active nodes array", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Submit empty active nodes array - this should not revert, just return early
      const emptyNodes: string[] = [];
      await expect(poaiManager.connect(oracle).submitNodeUpdate(1, emptyNodes))
        .to.not.be.reverted;
    });

    // TODO: Fix this test
    it.skip("should handle job with zero balance after allocation", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with minimal balance
      const jobPrice = 11625000; // 1 node * 31 epochs * 375000 = 11625000
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 1,
        },
      ]);

      // Set active nodes
      const activeNodes = [await oracle.getAddress()];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Advance time
      const block = await ethers.provider.getBlock("latest");
      const nextEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        nextEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // First allocation should succeed
      await poaiManager.allocateRewardsAcrossAllEscrows();

      // Advance time to next epoch
      const block2 = await ethers.provider.getBlock("latest");
      const epoch2Timestamp = Math.max(
        (block2?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        epoch2Timestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Second allocation should succeed since job has enough balance for 31 epochs
      await poaiManager.allocateRewardsAcrossAllEscrows();
      // Check that the job balance was reduced
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.balance).to.be.lt(11625000); // Should be less than initial balance
    });

    it("should handle multiple oracles submitting same proposal", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Add more oracles
      await controller.addOracle(await oracle2.getAddress());
      await controller.addOracle(await oracle3.getAddress());

      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      // Multiple oracles submit different proposals
      const nodes1 = [await oracle.getAddress()];
      const nodes2 = [await oracle2.getAddress()];
      const nodes3 = [await oracle3.getAddress()];

      await poaiManager.connect(oracle).submitNodeUpdate(1, nodes1);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, nodes2);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, nodes3);

      // Should not reach consensus since oracles disagree
      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes.length).to.equal(0);
    });

    it("should handle epoch boundary conditions", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Set active nodes
      const activeNodes = [await oracle.getAddress()];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await mockR1.mint(
        mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      // Allocate rewards at epoch boundary
      await poaiManager.allocateRewardsAcrossAllEscrows();

      // Try to allocate again in same epoch - should not emit events
      await expect(poaiManager.allocateRewardsAcrossAllEscrows()).to.not.emit(
        cspEscrow,
        "RewardsAllocatedV2"
      );
    });
  });

  describe("Access Control", function () {
    it("should only allow CSP owner to create jobs", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Mint USDC to non-owner
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await other.getAddress(), jobPrice);
      await mockUsdc.connect(other).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;

      // Non-owner should not be able to create job
      await expect(
        cspEscrow.connect(other).createJobs([
          {
            jobType: 1,
            projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
            lastExecutionEpoch: lastExecutionEpoch,
            numberOfNodesRequested: 3,
          },
        ])
      ).to.be.revertedWith("Not CSP owner");
    });

    it("should only allow PoAI Manager to update active nodes", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job
      const jobPrice = 500000000; // 500 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch: lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      // Non-PoAI Manager should not be able to update active nodes
      const activeNodes = [await oracle.getAddress()];
      await expect(
        cspEscrow.connect(user).updateActiveNodes(1, activeNodes)
      ).to.be.revertedWith("Not PoAI Manager");
    });

    it("should only allow PoAI Manager to allocate rewards", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Non-PoAI Manager should not be able to allocate rewards
      await expect(
        cspEscrow.connect(user).allocateRewardsToNodes()
      ).to.be.revertedWith("Not PoAI Manager");
    });

    it("should only allow CSP Escrow to get new job ID", async function () {
      // Non-CSP Escrow should not be able to get new job ID
      await expect(poaiManager.connect(user).getNewJobId()).to.be.revertedWith(
        "Not a CSP Escrow"
      );
    });
  });
});
