import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { AbiCoder, Signer } from "ethers";
import {
  buyLicenseAndLinkNode,
  deployController,
  deployMNDContract,
  deployNDContract,
  deployR1,
  deployUniswapMocks,
  ONE_DAY_IN_SECS,
  START_EPOCH_TIMESTAMP,
  takeSnapshot,
  revertSnapshotAndCapture,
} from "./helpers";
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
  let mockUniswapRouter: UniswapMockRouter;
  let mockUniswapPair: UniswapMockPair;

  const BURN_PERCENTAGE = 15n;

  beforeEach(async function () {
    [owner, user, oracle, other, oracle2, oracle3, oracle4, oracle5] =
      await ethers.getSigners();

    r1 = await deployR1(owner);
    controller = await deployController({
      owner,
      oracleSigners: [oracle],
    });

    ndContract = await deployNDContract({
      r1,
      controller,
      owner,
    });
    await r1.setNdContract(await ndContract.getAddress());
    await ndContract.setDirectAddLpPercentage(50n);

    mndContract = await deployMNDContract({
      r1,
      controller,
      owner,
    });
    await ndContract.setMNDContract(await mndContract.getAddress());
    await mndContract.setNDContract(await ndContract.getAddress());
    await r1.setMndContract(await owner.getAddress());

    await controller.setContracts(
      await ndContract.getAddress(),
      await mndContract.getAddress()
    );

    const { usdc, router, pair } = await deployUniswapMocks(r1);
    mockUsdc = usdc;
    mockUniswapRouter = router;
    mockUniswapPair = pair;

    await ndContract.setUniswapParams(
      await mockUniswapRouter.getAddress(),
      await mockUniswapPair.getAddress(),
      await mockUsdc.getAddress()
    );
    const ownerAddress = await owner.getAddress();
    await ndContract.setCompanyWallets(
      ownerAddress,
      ownerAddress,
      ownerAddress
    );
    await mockUsdc.mint(
      await mockUniswapRouter.getAddress(),
      50000000000000000000000n
    );

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
        await r1.getAddress(),
        await mockUniswapRouter.getAddress(),
        await mockUniswapPair.getAddress(),
        await owner.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await poaiManager.waitForDeployment();
    await ndContract.setPoAIManager(await poaiManager.getAddress());

    // Set timestamp to start epoch + 1 day to avoid epoch 0 underflow issues
    const block = await ethers.provider.getBlock("latest");
    const nextTimestamp = Math.max(
      (block?.timestamp || 0) + 1,
      START_EPOCH_TIMESTAMP + ONE_DAY_IN_SECS
    );
    await ethers.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);
    await ethers.provider.send("evm_mine", []);

    snapshotId = await takeSnapshot();
  });

  afterEach(async function () {
    snapshotId = await revertSnapshotAndCapture(snapshotId);
  });

  // Helper function to setup user with MND license and linked oracle node
  async function setupUserWithOracleNode(
    userSigner: Signer,
    oracleSigner: Signer
  ) {
    const nodeAddress = await oracleSigner.getAddress();

    await buyLicenseAndLinkNode({
      r1,
      nd: ndContract,
      mintAuthority: owner,
      buyer: userSigner,
      oracleSigner,
      nodeAddress,
    });

    const newTotalAssignedAmount = ethers.parseEther("1000");
    await mndContract
      .connect(owner)
      .addLicense(await userSigner.getAddress(), newTotalAssignedAmount);
  }

  // Helper function to setup user with escrow deployed
  async function setupUserWithEscrow(userSigner: Signer, oracleSigner: Signer) {
    await setupUserWithOracleNode(userSigner, oracleSigner);
    await poaiManager.connect(userSigner).deployCspEscrow();
    const escrowAddress = await poaiManager.ownerToEscrow(
      await userSigner.getAddress()
    );
    await r1.connect(owner).addBurner(escrowAddress);
    return escrowAddress;
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

  async function setupPendingJob() {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const jobDuration = 31n;
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + jobDuration;
    const numberOfNodesRequested = 1n;
    const jobType = 1;
    const userAddress = await user.getAddress();
    const pricePerEpoch = await cspEscrow.getPriceForJobType(jobType);
    const totalCost = pricePerEpoch * numberOfNodesRequested * jobDuration;
    const projectHash = ethers.keccak256(ethers.toUtf8Bytes("pending-job"));

    await mockUsdc.mint(userAddress, totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    const jobRequest = {
      jobType,
      projectHash,
      lastExecutionEpoch,
      numberOfNodesRequested,
    };
    const jobIds = await cspEscrow
      .connect(user)
      .createJobs.staticCall([jobRequest]);
    await cspEscrow.connect(user).createJobs([jobRequest]);

    return {
      cspEscrow,
      escrowAddress,
      jobId: jobIds[0],
      totalCost,
    };
  }

  async function advanceEpochs(count: number = 1) {
    await ethers.provider.send("evm_increaseTime", [ONE_DAY_IN_SECS * count]);
    await ethers.provider.send("evm_mine", []);
  }

  function getJobStructSlot(
    jobId: bigint,
    mappingSlot: number,
    fieldOffset: number
  ): string {
    const baseSlot = BigInt(
      ethers.keccak256(
        ethers.concat([
          ethers.zeroPadValue(ethers.toBeHex(jobId), 32),
          ethers.zeroPadValue(ethers.toBeHex(mappingSlot), 32),
        ])
      )
    );
    return ethers.zeroPadValue(
      ethers.toBeHex(baseSlot + BigInt(fieldOffset)),
      32
    );
  }

  it("should return empty array when there are no active jobs", async function () {
    const jobs = await poaiManager.getAllActiveJobs();
    expect(jobs.length).to.equal(0);
  });

  it("should revert if user does not own an oracle node", async function () {
    await expect(
      poaiManager.connect(user).deployCspEscrow()
    ).to.be.revertedWith("No oracle node owned");
  });

  it("should deploy a new CSP Escrow for a user with an oracle node and multiple licenses (ND path)", async function () {
    const nodeAddress = await oracle.getAddress();
    const otherNodeAddress = await other.getAddress();

    await buyLicenseAndLinkNode({
      r1,
      nd: ndContract,
      mintAuthority: owner,
      buyer: user,
      oracleSigner: oracle,
      nodeAddress: otherNodeAddress,
    });
    await buyLicenseAndLinkNode({
      r1,
      nd: ndContract,
      mintAuthority: owner,
      buyer: user,
      oracleSigner: oracle,
      nodeAddress,
    });

    const mndLicenses = await mndContract.getLicenses(await user.getAddress());
    expect(mndLicenses.length).to.equal(0);

    await poaiManager.connect(user).deployCspEscrow();
    const escrowAddress = await poaiManager.ownerToEscrow(
      await user.getAddress()
    );
    expect(escrowAddress).to.not.equal(ethers.ZeroAddress);
  });

  it("should deploy a new CSP Escrow for a user with an oracle node (MND path)", async function () {
    await setupUserWithOracleNode(user, oracle);

    // Now user has a node that is an oracle, should succeed and register escrow as burner
    await poaiManager.connect(user).deployCspEscrow();
    const escrowAddress = await poaiManager.ownerToEscrow(
      await user.getAddress()
    );
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

  it("should return the active job count for a single escrow", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const epochs = 35n;
    const numberOfNodesRequested = 1n;
    const lastExecutionEpoch = currentEpoch + epochs;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * numberOfNodesRequested * epochs;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(ethers.toUtf8Bytes("single-escrow-job")),
        lastExecutionEpoch,
        numberOfNodesRequested,
      },
    ]);

    expect(await poaiManager.getActiveJobsCount()).to.equal(1);
  });

  it("should return active job details for a single escrow", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const userAddress = await user.getAddress();
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const lastExecutionEpoch = currentEpoch + 35n;
    const numberOfNodesRequested = 2n;
    const numberOfEpochs = lastExecutionEpoch - currentEpoch;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * numberOfNodesRequested * numberOfEpochs;

    await mockUsdc.mint(userAddress, totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    const projectHash = ethers.keccak256(
      ethers.toUtf8Bytes("single-escrow-active-job")
    );

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash,
        lastExecutionEpoch,
        numberOfNodesRequested,
      },
    ]);

    const jobs = await poaiManager.getAllActiveJobs();
    expect(jobs.length).to.equal(1);

    const [job] = jobs;
    expect(job.id).to.equal(1n);
    expect(job.projectHash).to.equal(projectHash);
    expect(job.numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(job.pricePerEpoch).to.equal(pricePerEpoch);
    expect(job.balance).to.equal(totalCost);
    expect(job.escrowAddress).to.equal(escrowAddress);
    expect(job.escrowOwner).to.equal(userAddress);
    expect(job.activeNodes.length).to.equal(0);
  });

  describe("redeemUnusedJob", function () {
    it("allows the CSP owner to redeem unused USDC for a pending job after cooldown", async function () {
      const { cspEscrow, jobId, totalCost } = await setupPendingJob();
      const userAddress = await user.getAddress();

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const balanceBefore = await mockUsdc.balanceOf(userAddress);

      await expect(cspEscrow.connect(user).redeemUnusedJob(jobId))
        .to.emit(cspEscrow, "JobRedeemed")
        .withArgs(jobId, userAddress, totalCost);

      const balanceAfter = await mockUsdc.balanceOf(userAddress);
      expect(balanceAfter).to.equal(balanceBefore + totalCost);

      const jobDetails = await cspEscrow.getJobDetails(jobId);
      expect(jobDetails.id).to.equal(0n);
      expect(await cspEscrow.getActiveJobsCount()).to.equal(0n);
      expect(await poaiManager.jobIdToEscrow(jobId)).to.equal(
        ethers.ZeroAddress
      );
    });

    it("reverts if redemption is attempted before the cooldown has elapsed", async function () {
      const { cspEscrow, jobId } = await setupPendingJob();

      await expect(
        cspEscrow.connect(user).redeemUnusedJob(jobId)
      ).to.be.revertedWith("Redemption cooldown not elapsed");
    });

    it("reverts if the job already started", async function () {
      const { cspEscrow, jobId } = await setupPendingJob();
      const nodeAddress = await oracle.getAddress();

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);
      await poaiManager.connect(oracle).submitNodeUpdate(jobId, [nodeAddress]);

      await expect(
        cspEscrow.connect(user).redeemUnusedJob(jobId)
      ).to.be.revertedWith("Job already started");
    });

    it("reverts if the job has pending consensus updates", async function () {
      await controller.addOracle(await oracle2.getAddress());
      const { cspEscrow, jobId } = await setupPendingJob();

      await poaiManager
        .connect(oracle)
        .submitNodeUpdate(jobId, [await oracle.getAddress()]);

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        cspEscrow.connect(user).redeemUnusedJob(jobId)
      ).to.be.revertedWith("Job is unvalidated, cannot remove");
    });

    it("reverts if called by a non-owner", async function () {
      const { cspEscrow, jobId } = await setupPendingJob();

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        cspEscrow.connect(other).redeemUnusedJob(jobId)
      ).to.be.revertedWith("Not CSP owner");
    });
  });

  it("should aggregate active job counts across multiple escrows", async function () {
    const firstEscrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const firstEscrow: CspEscrow = CspEscrow.attach(
      firstEscrowAddress
    ) as CspEscrow;

    const initialEpoch = await poaiManager.getCurrentEpoch();
    const epochs = 32n;
    const numberOfNodesRequested = 1n;
    const firstLastExecutionEpoch = initialEpoch + epochs;
    const pricePerEpoch = await firstEscrow.getPriceForJobType(1);
    const firstCost = pricePerEpoch * numberOfNodesRequested * epochs;

    const userAddress = await user.getAddress();
    await mockUsdc.mint(userAddress, firstCost);
    await mockUsdc.connect(user).approve(firstEscrowAddress, firstCost);

    const firstProjectHash = ethers.keccak256(
      ethers.toUtf8Bytes("first-escrow-job")
    );
    await firstEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: firstProjectHash,
        lastExecutionEpoch: firstLastExecutionEpoch,
        numberOfNodesRequested,
      },
    ]);

    await controller.addOracle(await oracle2.getAddress());
    const secondEscrowAddress = await setupUserWithEscrow(other, oracle2);
    const secondEscrow: CspEscrow = CspEscrow.attach(
      secondEscrowAddress
    ) as CspEscrow;

    const updatedEpoch = await poaiManager.getCurrentEpoch();
    const secondEpochs = 40n;
    const secondLastExecutionEpoch = updatedEpoch + secondEpochs;
    const secondPricePerEpoch = await secondEscrow.getPriceForJobType(1);
    const secondCost =
      secondPricePerEpoch * numberOfNodesRequested * secondEpochs;

    const otherAddress = await other.getAddress();
    await mockUsdc.mint(otherAddress, secondCost * 2n);
    await mockUsdc.connect(other).approve(secondEscrowAddress, secondCost * 2n);

    const secondProjectHashA = ethers.keccak256(
      ethers.toUtf8Bytes("second-escrow-job-a")
    );
    const secondProjectHashB = ethers.keccak256(
      ethers.toUtf8Bytes("second-escrow-job-b")
    );

    await secondEscrow.connect(other).createJobs([
      {
        jobType: 1,
        projectHash: secondProjectHashA,
        lastExecutionEpoch: secondLastExecutionEpoch,
        numberOfNodesRequested,
      },
      {
        jobType: 1,
        projectHash: secondProjectHashB,
        lastExecutionEpoch: secondLastExecutionEpoch,
        numberOfNodesRequested,
      },
    ]);

    expect(await poaiManager.getActiveJobsCount()).to.equal(3);

    const jobs = await poaiManager.getAllActiveJobs();
    expect(jobs.length).to.equal(3);
    expect(jobs.map((job) => job.id)).to.deep.equal([1n, 2n, 3n]);
    expect(jobs[0].escrowAddress).to.equal(firstEscrowAddress);
    expect(jobs[0].escrowOwner).to.equal(userAddress);
    expect(jobs[0].projectHash).to.equal(firstProjectHash);
    expect(jobs[0].numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(jobs[0].balance).to.equal(firstCost);
    expect(jobs[1].escrowAddress).to.equal(secondEscrowAddress);
    expect(jobs[1].escrowOwner).to.equal(otherAddress);
    expect(jobs[1].projectHash).to.equal(secondProjectHashA);
    expect(jobs[1].numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(jobs[1].balance).to.equal(secondCost);
    expect(jobs[2].escrowAddress).to.equal(secondEscrowAddress);
    expect(jobs[2].escrowOwner).to.equal(otherAddress);
    expect(jobs[2].projectHash).to.equal(secondProjectHashB);
    expect(jobs[2].numberOfNodesRequested).to.equal(numberOfNodesRequested);
    expect(jobs[2].balance).to.equal(secondCost);
    expect(jobs[0].activeNodes.length).to.equal(0);
    expect(jobs[1].activeNodes.length).to.equal(0);
    expect(jobs[2].activeNodes.length).to.equal(0);
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

  it("should allow CSP owner to extend job nodes with remaining epoch pricing", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const jobType = 1;
    const initialNodes = 2n;
    const currentEpoch = await poaiManager.getCurrentEpoch();
    const additionalEpochs = 40n;
    const lastExecutionEpoch = currentEpoch + additionalEpochs;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(jobType);
    const initialCost = pricePerEpoch * initialNodes * additionalEpochs;

    await mockUsdc.mint(await user.getAddress(), initialCost);
    await mockUsdc.connect(user).approve(escrowAddress, initialCost);

    const projectHash = ethers.keccak256(
      ethers.toUtf8Bytes("extend-job-nodes-success")
    );
    await cspEscrow.connect(user).createJobs([
      {
        jobType,
        projectHash,
        lastExecutionEpoch,
        numberOfNodesRequested: initialNodes,
      },
    ]);

    const jobBefore = await cspEscrow.getJobDetails(1);
    const remainingEpochs = jobBefore.lastExecutionEpoch - currentEpoch;
    const newNumberOfNodes = initialNodes + 3n;
    const additionalNodes = newNumberOfNodes - initialNodes;
    const additionalAmount =
      jobBefore.pricePerEpoch * additionalNodes * remainingEpochs;

    await mockUsdc.mint(await user.getAddress(), additionalAmount);
    await mockUsdc.connect(user).approve(escrowAddress, additionalAmount);

    await expect(cspEscrow.connect(user).extendJobNodes(1, newNumberOfNodes))
      .to.emit(cspEscrow, "JobNodesExtended")
      .withArgs(1, newNumberOfNodes, additionalAmount);

    const jobAfter = await cspEscrow.getJobDetails(1);
    expect(jobAfter.numberOfNodesRequested).to.equal(newNumberOfNodes);
    expect(jobAfter.balance).to.equal(jobBefore.balance + additionalAmount);
    expect(await mockUsdc.balanceOf(escrowAddress)).to.equal(
      initialCost + additionalAmount
    );
  });

  it("should revert when extending nodes for a non-existent job", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    await expect(
      cspEscrow.connect(user).extendJobNodes(999, 2)
    ).to.be.revertedWith("Job does not exist");
  });

  it("should revert when new number of nodes is not greater than current", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const numberOfNodes = 3n;
    const epochs = 35n;
    const lastExecutionEpoch = currentEpoch + epochs;
    const totalCost = pricePerEpoch * numberOfNodes * epochs;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(
          ethers.toUtf8Bytes("extend-job-nodes-same")
        ),
        lastExecutionEpoch,
        numberOfNodesRequested: numberOfNodes,
      },
    ]);

    await expect(
      cspEscrow.connect(user).extendJobNodes(1, numberOfNodes)
    ).to.be.revertedWith("New number of nodes must be greater");

    await expect(
      cspEscrow.connect(user).extendJobNodes(1, numberOfNodes - 1n)
    ).to.be.revertedWith("New number of nodes must be greater");
  });

  it("should revert when extending nodes after job end", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const epochs = 31n;
    const lastExecutionEpoch = currentEpoch + epochs;
    const numberOfNodes = 2n;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * numberOfNodes * epochs;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(
          ethers.toUtf8Bytes("extend-job-nodes-ended")
        ),
        lastExecutionEpoch,
        numberOfNodesRequested: numberOfNodes,
      },
    ]);

    await advanceEpochs(Number(epochs + 1n));

    await expect(
      cspEscrow.connect(user).extendJobNodes(1, numberOfNodes + 1n)
    ).to.be.revertedWith("Job has already ended");
  });

  it("should revert when caller is not the CSP owner", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const numberOfNodes = 2n;
    const epochs = 40n;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * numberOfNodes * epochs;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(
          ethers.toUtf8Bytes("extend-job-nodes-unauthorized")
        ),
        lastExecutionEpoch: currentEpoch + epochs,
        numberOfNodesRequested: numberOfNodes,
      },
    ]);

    await expect(
      cspEscrow.connect(other).extendJobNodes(1, numberOfNodes + 1n)
    ).to.be.revertedWith("Not CSP owner");
  });

  it("should revert when insufficient USDC allowance for node extension", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const currentEpoch = await poaiManager.getCurrentEpoch();
    const numberOfNodes = 2n;
    const epochs = 38n;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * numberOfNodes * epochs;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(
          ethers.toUtf8Bytes("extend-job-nodes-no-funds")
        ),
        lastExecutionEpoch: currentEpoch + epochs,
        numberOfNodesRequested: numberOfNodes,
      },
    ]);

    await expect(
      cspEscrow.connect(user).extendJobNodes(1, numberOfNodes + 1n)
    ).to.be.revertedWithCustomError(mockUsdc, "ERC20InsufficientAllowance");
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

  it("extends lastExecutionEpoch when the job starts in a later epoch", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const paymentEpoch = await poaiManager.getCurrentEpoch();
    const jobDuration = 35n;
    const lastExecutionEpoch = paymentEpoch + jobDuration;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * jobDuration;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(
          ethers.toUtf8Bytes("delayed-start-project")
        ),
        lastExecutionEpoch,
        numberOfNodesRequested: 1,
      },
    ]);
    const jobDetailsBefore = await cspEscrow.getJobDetails(1);
    expect(jobDetailsBefore.startTimestamp).to.equal(0);
    expect(jobDetailsBefore.lastExecutionEpoch).to.equal(lastExecutionEpoch);

    const epochsBeforeEffectiveStart = 3;
    await advanceEpochs(epochsBeforeEffectiveStart);
    const startEpoch = await poaiManager.getCurrentEpoch();
    const activeNodes = [await oracle.getAddress()];
    await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

    const jobDetailsAfter = await cspEscrow.getJobDetails(1);
    const purchasedEpochs = lastExecutionEpoch - paymentEpoch;
    const expectedLastExecutionEpoch = startEpoch + purchasedEpochs;
    expect(jobDetailsAfter.startTimestamp).to.be.gt(0);
    expect(jobDetailsAfter.lastExecutionEpoch).to.equal(
      expectedLastExecutionEpoch
    );
    expect(jobDetailsAfter.lastExecutionEpoch).to.equal(
      lastExecutionEpoch + BigInt(epochsBeforeEffectiveStart)
    );
  });

  it("reconciles lastExecutionEpoch across all escrows", async function () {
    const escrowAddress = await setupUserWithEscrow(user, oracle);
    const CspEscrow = await ethers.getContractFactory("CspEscrow");
    const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

    const creationEpoch = await poaiManager.getCurrentEpoch();
    const jobDuration = 35n;
    const lastExecutionEpoch = creationEpoch + jobDuration;
    const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
    const totalCost = pricePerEpoch * jobDuration;

    await mockUsdc.mint(await user.getAddress(), totalCost);
    await mockUsdc.connect(user).approve(escrowAddress, totalCost);

    await cspEscrow.connect(user).createJobs([
      {
        jobType: 1,
        projectHash: ethers.keccak256(ethers.toUtf8Bytes("reconcile-project")),
        lastExecutionEpoch,
        numberOfNodesRequested: 1,
      },
    ]);

    await advanceEpochs(1);
    const startEpoch = await poaiManager.getCurrentEpoch();
    const activeNodes = [await oracle.getAddress()];
    await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

    const jobAfterStart = await cspEscrow.getJobDetails(1);
    const expectedCorrectLastExecutionEpoch = startEpoch + jobDuration;
    expect(jobAfterStart.lastExecutionEpoch).to.equal(
      expectedCorrectLastExecutionEpoch
    );

    const mappingSlot = 7;
    const lastExecutionEpochSlot = getJobStructSlot(1n, mappingSlot, 7);
    const legacyLastExecutionEpoch = creationEpoch + jobDuration;
    await ethers.provider.send("hardhat_setStorageAt", [
      escrowAddress,
      lastExecutionEpochSlot,
      ethers.zeroPadValue(ethers.toBeHex(legacyLastExecutionEpoch), 32),
    ]);

    const jobWithLegacyValue = await cspEscrow.getJobDetails(1);
    expect(jobWithLegacyValue.lastExecutionEpoch).to.equal(
      legacyLastExecutionEpoch
    );

    const tx = await poaiManager.reconcileAllJobsAcrossEscrows();
    const receipt = await tx.wait();
    const parsedEvents = receipt?.logs
      .filter((log) => log.address === escrowAddress)
      .map((log) => {
        try {
          return cspEscrow.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(
        (event): event is ReturnType<typeof cspEscrow.interface.parseLog> =>
          !!event
      );

    const reconciliationEvents = (parsedEvents ?? []).filter(
      (event) => event?.name === "JobLastExecutionEpochReconciled"
    );
    expect(reconciliationEvents.length).to.equal(1);
    expect(reconciliationEvents[0]?.args[0]).to.equal(1n);
    expect(reconciliationEvents[0]?.args[1]).to.equal(legacyLastExecutionEpoch);
    expect(reconciliationEvents[0]?.args[2]).to.equal(
      expectedCorrectLastExecutionEpoch
    );

    const reconciledJob = await cspEscrow.getJobDetails(1);
    expect(reconciledJob.lastExecutionEpoch).to.equal(
      expectedCorrectLastExecutionEpoch
    );
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
        Number(numberOfEpochs) * ONE_DAY_IN_SECS,
      ]);
      await ethers.provider.send("evm_mine", []);

      expect(await cspEscrow.getFirstClosableJobId()).to.eq(1);
      expect(await poaiManager.getFirstClosableJobId()).to.eq(1);
    });

    it("allows closing a job after it becomes closable", async function () {
      const { cspEscrow, numberOfEpochs } = await setupJobWithActiveNodes();

      await ethers.provider.send("evm_increaseTime", [
        Number(numberOfEpochs) * ONE_DAY_IN_SECS,
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

    it("should reach consensus with 20 oracles when 11 submit matching nodes", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      const jobPrice = 100000000;
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 31n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(
            ethers.toUtf8Bytes("consensus-20-oracles")
          ),
          lastExecutionEpoch,
          numberOfNodesRequested: 5,
        },
      ]);

      const targetOracles = 20;
      let registeredOracles: string[] = await controller.getOracles();
      if (registeredOracles.length < targetOracles) {
        const allSigners = await ethers.getSigners();
        const existing = new Set(
          registeredOracles.map((addr) => addr.toLowerCase())
        );
        for (const signer of allSigners) {
          if (existing.size >= targetOracles) {
            break;
          }
          const address = await signer.getAddress();
          const normalized = address.toLowerCase();
          if (!existing.has(normalized)) {
            await controller.addOracle(address);
            existing.add(normalized);
          }
        }
      }
      registeredOracles = await controller.getOracles();
      expect(registeredOracles.length).to.equal(targetOracles);

      const allSigners = await ethers.getSigners();
      const signerEntries = await Promise.all(
        allSigners.map(async (signer) => {
          const address = await signer.getAddress();
          return [address.toLowerCase(), signer] as const;
        })
      );
      const signerMap = new Map(signerEntries);

      const consensusNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      for (let i = 0; i < 11; i++) {
        const oracleAddress = registeredOracles[i];
        const oracleSigner = signerMap.get(oracleAddress.toLowerCase());
        if (!oracleSigner) {
          throw new Error("missing oracle signer");
        }
        await poaiManager
          .connect(oracleSigner)
          .submitNodeUpdate(1, consensusNodes);
      }

      const jobDetails = await cspEscrow.getJobDetails(1);
      expect(jobDetails.activeNodes).to.deep.equal(consensusNodes);
      expect(jobDetails.startTimestamp).to.be.gt(0);
    });
  });

  describe("Rewards Allocation and Burning", function () {
    it("should allocate rewards to active nodes and burn 15%", async function () {
      await controller.addOracle(await oracle2.getAddress());
      await controller.addOracle(await oracle3.getAddress());

      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      await buyLicenseAndLinkNode({
        r1,
        nd: ndContract,
        mintAuthority: owner,
        buyer: user,
        oracleSigner: oracle2,
        nodeAddress: await oracle2.getAddress(),
      });
      await buyLicenseAndLinkNode({
        r1,
        nd: ndContract,
        mintAuthority: owner,
        buyer: user,
        oracleSigner: oracle3,
        nodeAddress: await oracle3.getAddress(),
      });

      const jobPrice = 1_000_000_000n; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch,
          numberOfNodesRequested: 3,
        },
      ]);

      const jobDetailsBefore = await cspEscrow.getJobDetails(1);
      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
        await oracle3.getAddress(),
      ];

      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, activeNodes);
      await poaiManager.connect(oracle3).submitNodeUpdate(1, activeNodes);

      await r1.mint(
        await mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );
      await advanceEpochs(1);

      const tx = await poaiManager.allocateRewardsAcrossAllEscrows();
      const receipt = await tx.wait();

      const parsedEvents = receipt?.logs
        .filter((log) => log.address === escrowAddress)
        .map((log) => {
          try {
            return cspEscrow.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(
          (event): event is ReturnType<typeof cspEscrow.interface.parseLog> =>
            !!event
        );

      const rewardEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "RewardsAllocatedV3"
      );
      expect(rewardEvents.length).to.equal(activeNodes.length);

      const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
      const burnPerNode = (pricePerEpoch * BURN_PERCENTAGE) / 100n;
      const rewardPerNode = pricePerEpoch - burnPerNode;
      const totalBurn = burnPerNode * BigInt(activeNodes.length);

      for (const event of rewardEvents) {
        expect(event?.args[0]).to.equal(1n);
        expect(event?.args[1]).to.be.oneOf(activeNodes);
        expect(event?.args[2]).to.equal(rewardPerNode);
      }

      const burnEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "TokensBurned"
      );
      expect(burnEvents.length).to.equal(1);
      expect(burnEvents[0]?.args[0]).to.equal(totalBurn);

      for (const node of activeNodes) {
        expect(await cspEscrow.virtualWalletBalance(node)).to.equal(
          rewardPerNode
        );
      }

      const jobDetails = await cspEscrow.getJobDetails(1);
      const expectedBalance =
        jobDetailsBefore.balance - pricePerEpoch * BigInt(activeNodes.length);
      expect(jobDetails.balance).to.equal(expectedBalance);
      expect(jobDetails.lastAllocatedEpoch).to.equal(
        (await poaiManager.getCurrentEpoch()) - 1n
      );
    });

    it("should allocate rewards across 100 jobs with 2 nodes each", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      const numberOfEpochs = lastExecutionEpoch - currentEpoch;
      const numberOfJobs = 100;
      const nodesPerJob = 2n;
      const totalCost =
        pricePerEpoch * nodesPerJob * numberOfEpochs * BigInt(numberOfJobs);

      await mockUsdc.mint(await user.getAddress(), totalCost);
      await mockUsdc.connect(user).approve(escrowAddress, totalCost);

      const jobRequests = Array.from({ length: numberOfJobs }, (_, index) => ({
        jobType: 1,
        projectHash: ethers.keccak256(ethers.toUtf8Bytes(`mass-job-${index}`)),
        lastExecutionEpoch,
        numberOfNodesRequested: Number(nodesPerJob),
      }));

      await cspEscrow.connect(user).createJobs(jobRequests);

      const signers = await ethers.getSigners();
      const nodeAddresses = await Promise.all(
        signers.slice(2, 12).map((signer) => signer.getAddress())
      );
      expect(nodeAddresses.length).to.equal(10);

      for (let i = 1; i < nodeAddresses.length; i++) {
        await buyLicenseAndLinkNode({
          r1,
          nd: ndContract,
          mintAuthority: owner,
          buyer: user,
          oracleSigner: oracle,
          nodeAddress: nodeAddresses[i],
        });
      }

      const nodeJobCounts = new Map<string, bigint>();

      for (let jobIndex = 0; jobIndex < numberOfJobs; jobIndex++) {
        const jobId = jobIndex + 1;
        const firstNode = nodeAddresses[jobIndex % nodeAddresses.length];
        const secondNode = nodeAddresses[(jobIndex + 1) % nodeAddresses.length];
        const jobNodes = [firstNode, secondNode];

        await poaiManager.connect(oracle).submitNodeUpdate(jobId, jobNodes);

        nodeJobCounts.set(firstNode, (nodeJobCounts.get(firstNode) ?? 0n) + 1n);
        nodeJobCounts.set(
          secondNode,
          (nodeJobCounts.get(secondNode) ?? 0n) + 1n
        );
      }

      await r1.mint(
        await mockUniswapRouter.getAddress(),
        ethers.parseEther("100000")
      );
      await advanceEpochs(1);

      const tx = await poaiManager.allocateRewardsAcrossAllEscrows();
      const receipt = await tx.wait();

      const parsedEvents = receipt?.logs
        .filter((log) => log.address === escrowAddress)
        .map((log) => {
          try {
            return cspEscrow.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(
          (event): event is ReturnType<typeof cspEscrow.interface.parseLog> =>
            !!event
        );

      const rewardEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "RewardsAllocatedV3"
      );
      expect(rewardEvents.length).to.equal(numberOfJobs * Number(nodesPerJob));

      const burnPerNode = (pricePerEpoch * BURN_PERCENTAGE) / 100n;
      const rewardPerNode = pricePerEpoch - burnPerNode;
      const totalBurn = burnPerNode * nodesPerJob * BigInt(numberOfJobs);
      const expectedLastAllocatedEpoch =
        (await poaiManager.getCurrentEpoch()) - 1n;

      const actualNodeCounts = new Map<string, bigint>();
      for (const event of rewardEvents) {
        const nodeAddr = event?.args[1] as string;
        expect(nodeAddresses).to.include(nodeAddr);
        expect(event?.args[0]).to.be.gte(1n);
        expect(event?.args[0]).to.be.lte(BigInt(numberOfJobs));
        expect(event?.args[2]).to.equal(rewardPerNode);

        actualNodeCounts.set(
          nodeAddr,
          (actualNodeCounts.get(nodeAddr) ?? 0n) + 1n
        );
      }
      expect(actualNodeCounts.size).to.equal(nodeJobCounts.size);
      for (const [nodeAddr, expectedCount] of nodeJobCounts.entries()) {
        expect(actualNodeCounts.get(nodeAddr)).to.equal(expectedCount);
      }

      const burnEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "TokensBurned"
      );
      expect(burnEvents.length).to.equal(1);
      expect(burnEvents[0]?.args[0]).to.equal(totalBurn);

      for (const [nodeAddr, count] of nodeJobCounts.entries()) {
        const balance = await cspEscrow.virtualWalletBalance(nodeAddr);
        expect(balance).to.equal(rewardPerNode * count);
      }

      const initialBalance = pricePerEpoch * nodesPerJob * numberOfEpochs;
      const expectedBalance = initialBalance - pricePerEpoch * nodesPerJob;
      for (let jobId = 1; jobId <= numberOfJobs; jobId++) {
        const jobDetails = await cspEscrow.getJobDetails(jobId);
        expect(jobDetails.balance).to.equal(expectedBalance);
        expect(jobDetails.lastAllocatedEpoch).to.equal(
          expectedLastAllocatedEpoch
        );
      }
    });

    it("should burn 15% of rewards by swapping USDC for R1", async function () {
      await controller.addOracle(await oracle2.getAddress());

      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      await buyLicenseAndLinkNode({
        r1,
        nd: ndContract,
        mintAuthority: owner,
        buyer: user,
        oracleSigner: oracle2,
        nodeAddress: await oracle2.getAddress(),
      });

      const jobPrice = 1_000_000_000n; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, activeNodes);

      await r1.mint(
        await mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );
      await advanceEpochs(1);

      const tx = await poaiManager.allocateRewardsAcrossAllEscrows();
      const receipt = await tx.wait();

      const parsedEvents = receipt?.logs
        .filter((log) => log.address === escrowAddress)
        .map((log) => {
          try {
            return cspEscrow.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter(
          (event): event is ReturnType<typeof cspEscrow.interface.parseLog> =>
            !!event
        );

      const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
      const burnPerNode = (pricePerEpoch * BURN_PERCENTAGE) / 100n;
      const rewardPerNode = pricePerEpoch - burnPerNode;
      const totalBurn = burnPerNode * BigInt(activeNodes.length);

      const rewardEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "RewardsAllocatedV3"
      );
      expect(rewardEvents.length).to.equal(activeNodes.length);
      for (const event of rewardEvents) {
        expect(event?.args[2]).to.equal(rewardPerNode);
      }

      const burnEvents = (parsedEvents ?? []).filter(
        (event) => event?.name === "TokensBurned"
      );
      expect(burnEvents.length).to.equal(1);
      expect(burnEvents[0]?.args[0]).to.equal(totalBurn);
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
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY_IN_SECS
      );
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        noActiveNodesEpochTimestamp,
      ]);
      await ethers.provider.send("evm_mine", []);

      // Allocate rewards - should not emit any events
      await expect(poaiManager.allocateRewardsAcrossAllEscrows()).to.not.emit(
        cspEscrow,
        "RewardsAllocatedV3"
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

    it("should reconcile legacy job balances by subtracting historical burn", async function () {
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
      await poaiManager.connect(oracle).submitNodeUpdate(1, [nodeAddress]);

      await r1.mint(mockUniswapRouter.getAddress(), ethers.parseEther("1000"));
      await advanceEpochs(2);

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
        ethers.zeroPadValue(ethers.toBeHex(balanceSlot), 32),
        ethers.zeroPadValue(ethers.toBeHex(legacyBalance), 32),
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
        "RewardsAllocatedV3"
      );
    });

    it("should handle multiple epochs of reward allocation", async function () {
      await controller.addOracle(await oracle2.getAddress());

      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      await buyLicenseAndLinkNode({
        r1,
        nd: ndContract,
        mintAuthority: owner,
        buyer: user,
        oracleSigner: oracle2,
        nodeAddress: await oracle2.getAddress(),
      });

      const jobPrice = 1_000_000_000n; // 1000 USDC (6 decimals)
      await mockUsdc.mint(await user.getAddress(), jobPrice);
      await mockUsdc.connect(user).approve(escrowAddress, jobPrice);

      const currentEpoch = await poaiManager.getCurrentEpoch();
      const lastExecutionEpoch = currentEpoch + 35n;
      await cspEscrow.connect(user).createJobs([
        {
          jobType: 1,
          projectHash: ethers.keccak256(ethers.toUtf8Bytes("test-project")),
          lastExecutionEpoch,
          numberOfNodesRequested: 2,
        },
      ]);

      const activeNodes = [
        await oracle.getAddress(),
        await oracle2.getAddress(),
      ];

      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);
      await poaiManager.connect(oracle2).submitNodeUpdate(1, activeNodes);

      await r1.mint(
        await mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
      const burnPerNode = (pricePerEpoch * BURN_PERCENTAGE) / 100n;
      const rewardPerNode = pricePerEpoch - burnPerNode;

      for (let epoch = 1; epoch <= 3; epoch++) {
        await advanceEpochs(1);
        await poaiManager.allocateRewardsAcrossAllEscrows();
        const balance = await cspEscrow.virtualWalletBalance(
          await oracle.getAddress()
        );
        expect(balance).to.equal(rewardPerNode * BigInt(epoch));
      }
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
      await r1.mint(mockUniswapRouter.getAddress(), ethers.parseEther("1000"));

      // Advance time
      const block = await ethers.provider.getBlock("latest");
      const multipleEscrowsEpochTimestamp = Math.max(
        (block?.timestamp || 0) + 1,
        START_EPOCH_TIMESTAMP + 2 * ONE_DAY_IN_SECS
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
      expect(currentEpoch).to.equal(1); // Should be epoch 1 at start (START_EPOCH_TIMESTAMP + ONE_DAY_IN_SECS)

      // Advance time by one day
      const nextEpochTimestamp = START_EPOCH_TIMESTAMP + 2 * ONE_DAY_IN_SECS;
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

    it("should handle job with zero balance after allocation", async function () {
      const escrowAddress = await setupUserWithEscrow(user, oracle);
      const CspEscrow = await ethers.getContractFactory("CspEscrow");
      const cspEscrow: CspEscrow = CspEscrow.attach(escrowAddress) as CspEscrow;

      // Create job with minimal balance
      const jobPrice = 11_625_000n; // 1 node * 31 epochs * 375000 = 11625000
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

      const jobDetailsBefore = await cspEscrow.getJobDetails(1);

      // Set active nodes
      const activeNodes = [await oracle.getAddress()];
      await poaiManager.connect(oracle).submitNodeUpdate(1, activeNodes);

      // Mock R1 tokens for burning - mint to router so it can transfer them during swap
      await r1.mint(
        await mockUniswapRouter.getAddress(),
        ethers.parseEther("1000")
      );

      await advanceEpochs(1);
      await poaiManager.allocateRewardsAcrossAllEscrows();

      await advanceEpochs(1);
      await poaiManager.allocateRewardsAcrossAllEscrows();

      const pricePerEpoch = await cspEscrow.getPriceForJobType(1);
      const jobDetails = await cspEscrow.getJobDetails(1);
      const expectedBalance = jobDetailsBefore.balance - pricePerEpoch * 2n;
      expect(jobDetails.balance).to.equal(expectedBalance);
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
      await r1.mint(mockUniswapRouter.getAddress(), ethers.parseEther("1000"));

      // Allocate rewards at epoch boundary
      await poaiManager.allocateRewardsAcrossAllEscrows();

      // Try to allocate again in same epoch - should not emit events
      await expect(poaiManager.allocateRewardsAcrossAllEscrows()).to.not.emit(
        cspEscrow,
        "RewardsAllocatedV3"
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
