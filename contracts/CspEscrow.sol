// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./Controller.sol";
import "./R1.sol";

uint256 constant BURN_PERCENTAGE = 15; // 15%

// Job type constants
uint256 constant JOB_TYPE_ENTRY = 1;
uint256 constant JOB_TYPE_LOW1 = 2;
uint256 constant JOB_TYPE_LOW2 = 3;
uint256 constant JOB_TYPE_MED1 = 4;
uint256 constant JOB_TYPE_MED2 = 5;
uint256 constant JOB_TYPE_HIGH1 = 6;
uint256 constant JOB_TYPE_HIGH2 = 7;
uint256 constant JOB_TYPE_ULTRA1 = 8;
uint256 constant JOB_TYPE_ULTRA2 = 9;
// Service job types
uint256 constant JOB_TYPE_PGSQL_LOW = 10;
uint256 constant JOB_TYPE_PGSQL_MED = 11;
uint256 constant JOB_TYPE_MYSQL_LOW = 12;
uint256 constant JOB_TYPE_MYSQL_MED = 13;
uint256 constant JOB_TYPE_NOSQL_LOW = 14;
uint256 constant JOB_TYPE_NOSQL_MED = 15;
// Native app job types
uint256 constant JOB_TYPE_N_ENTRY = 16;
uint256 constant JOB_TYPE_N_MED1 = 17;
uint256 constant JOB_TYPE_N_MED2 = 18;
uint256 constant JOB_TYPE_N_HIGH = 19;
uint256 constant JOB_TYPE_N_ULTRA = 20;
// GPU job types
uint256 constant JOB_TYPE_G_ENTRY_MED1 = 21;
uint256 constant JOB_TYPE_G_ENTRY_MED2 = 22;
uint256 constant JOB_TYPE_G_ENTRY_N_ENTRY = 23;
uint256 constant JOB_TYPE_G_ENTRY_N_MED1 = 24;

uint256 constant JOB_TYPE_G_MED_MED2 = 25;
uint256 constant JOB_TYPE_G_MED_HIGH1 = 26;
uint256 constant JOB_TYPE_G_MED_HIGH2 = 27;
uint256 constant JOB_TYPE_G_MED_ULTRA1 = 28;
uint256 constant JOB_TYPE_G_MED_N_MED1 = 29;
uint256 constant JOB_TYPE_G_MED_N_MED2 = 30;
uint256 constant JOB_TYPE_G_MED_N_HIGH = 31;

uint256 constant JOB_TYPE_G_HIGH_HIGH2 = 32;
uint256 constant JOB_TYPE_G_HIGH_ULTRA1 = 33;
uint256 constant JOB_TYPE_G_HIGH_ULTRA2 = 34;
uint256 constant JOB_TYPE_G_HIGH_N_MED2 = 35;
uint256 constant JOB_TYPE_G_HIGH_N_HIGH = 36;
uint256 constant JOB_TYPE_G_HIGH_N_ULTRA = 37;

uint256 constant JOB_TYPE_G_ULTRA_ULTRA1 = 38;
uint256 constant JOB_TYPE_G_ULTRA_ULTRA2 = 39;
uint256 constant JOB_TYPE_G_ULTRA_N_ULTRA = 40;

interface IPoAIManager {
    function getNewJobId() external returns (uint256);
    function registerNodeWithRewards(address nodeAddress) external;
    function removeNodeFromRewardsList(address nodeAddress) external;
}

interface INDContract {
    function getNodeOwner(address nodeAddress) external view returns (address);
}

struct JobDetails {
    uint256 id;
    bytes32 projectHash;
    uint256 requestTimestamp;
    uint256 startTimestamp;
    uint256 lastNodesChangeTimestamp;
    uint256 jobType;
    uint256 pricePerEpoch;
    uint256 lastExecutionEpoch;
    uint256 numberOfNodesRequested;
    int256 balance;
    uint256 lastAllocatedEpoch;
    address[] activeNodes;
}

struct JobCreationRequest {
    uint256 jobType;
    bytes32 projectHash;
    uint256 lastExecutionEpoch;
    uint256 numberOfNodesRequested;
}

//TODO PoAI Manager should be able to refund USDC to CSP Owner
contract CspEscrow is Initializable {
    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    IPoAIManager public poaiManager;
    address public cspOwner;
    address public usdcToken;
    R1 public r1Token;
    Controller public controller;
    IUniswapV2Router02 public uniswapV2Router;
    IUniswapV2Pair public uniswapV2Pair;

    mapping(uint256 => JobDetails) public jobDetails;
    mapping(address => uint256) public virtualWalletBalance;

    uint256[] public activeJobs;
    uint256[] public closedJobs;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event JobCreated(
        uint256 indexed jobId,
        address indexed owner,
        uint256 jobType,
        uint256 pricePerEpoch
    );
    event JobStarted(uint256 indexed jobId, uint256 startTimestamp);
    event JobClosed(uint256 indexed jobId, uint256 closeTimestamp);
    event NodesUpdated(uint256 indexed jobId, address[] activeNodes);
    event RewardsClaimedV2(
        address indexed nodeAddr,
        address indexed nodeOwner,
        uint256 usdcAmount,
        uint256 r1Amount
    );
    event RewardsAllocatedV2(
        uint256 indexed jobId,
        address nodeAddress,
        address nodeOwner,
        uint256 usdcAmount
    );
    event TokensBurned(uint256 usdcAmount, uint256 r1Amount);
    event JobBalanceReconciled(uint256 indexed jobId, uint256 burnCorrection);

    //.########.##....##.########..########...#######..####.##....##.########..######.
    //.##.......###...##.##.....##.##.....##.##.....##..##..###...##....##....##....##
    //.##.......####..##.##.....##.##.....##.##.....##..##..####..##....##....##......
    //.######...##.##.##.##.....##.########..##.....##..##..##.##.##....##.....######.
    //.##.......##..####.##.....##.##........##.....##..##..##..####....##..........##
    //.##.......##...###.##.....##.##........##.....##..##..##...###....##....##....##
    //.########.##....##.########..##.........#######..####.##....##....##.....######.

    function initialize(
        address _cspOwner,
        address _poaiManager,
        address _usdcToken,
        address _r1Token,
        address _controller,
        address _uniswapV2Router,
        address _uniswapV2Pair
    ) public initializer {
        require(_usdcToken != address(0), "USDC token cannot be zero address");
        require(_r1Token != address(0), "R1 token cannot be zero address");
        require(_controller != address(0), "Controller cannot be zero address");
        require(
            _uniswapV2Router != address(0),
            "Uniswap router cannot be zero address"
        );
        require(
            _uniswapV2Pair != address(0),
            "Uniswap pair cannot be zero address"
        );

        cspOwner = _cspOwner;
        poaiManager = IPoAIManager(_poaiManager);
        usdcToken = _usdcToken;
        r1Token = R1(_r1Token);
        controller = Controller(_controller);
        uniswapV2Router = IUniswapV2Router02(_uniswapV2Router);
        uniswapV2Pair = IUniswapV2Pair(_uniswapV2Pair);
    }

    function createJobs(
        JobCreationRequest[] memory jobCreationRequests
    ) external onlyCspOwner returns (uint256[] memory) {
        uint256 currentEpoch = getCurrentEpoch();
        uint256[] memory jobIds = new uint256[](jobCreationRequests.length);
        for (uint256 i = 0; i < jobCreationRequests.length; i++) {
            require(
                jobCreationRequests[i].lastExecutionEpoch > currentEpoch,
                "Last execution epoch must be in the future"
            );
            uint256 numberOfEpochs = jobCreationRequests[i].lastExecutionEpoch -
                currentEpoch;
            uint256 pricePerEpoch = getPriceForJobType(
                jobCreationRequests[i].jobType
            );
            uint256 price = pricePerEpoch *
                jobCreationRequests[i].numberOfNodesRequested *
                numberOfEpochs;
            require(
                numberOfEpochs >= 30,
                "Number of epochs must be greater than 30"
            );
            require(
                jobCreationRequests[i].numberOfNodesRequested > 0,
                "Number of nodes must be greater than 0"
            );

            uint256 jobId = poaiManager.getNewJobId();

            // Transfer USDC from CSP owner to escrow
            require(
                IERC20(usdcToken).transferFrom(
                    msg.sender,
                    address(this),
                    price
                ),
                "USDC transfer failed"
            );

            jobDetails[jobId] = JobDetails({
                id: jobId,
                projectHash: jobCreationRequests[i].projectHash,
                requestTimestamp: block.timestamp,
                startTimestamp: 0,
                lastNodesChangeTimestamp: 0,
                jobType: jobCreationRequests[i].jobType,
                pricePerEpoch: pricePerEpoch,
                lastExecutionEpoch: jobCreationRequests[i].lastExecutionEpoch,
                numberOfNodesRequested: jobCreationRequests[i]
                    .numberOfNodesRequested,
                balance: int256(price),
                lastAllocatedEpoch: 0,
                activeNodes: new address[](0)
            });
            activeJobs.push(jobId);
            jobIds[i] = jobId;
            emit JobCreated(
                jobId,
                cspOwner,
                jobCreationRequests[i].jobType,
                pricePerEpoch
            );
        }
        return jobIds;
    }

    // Receive consensus-based updates from PoAI Manager
    function updateActiveNodes(
        uint256 jobId,
        address[] memory newActiveNodes
    ) external onlyPoAIManager {
        require(jobDetails[jobId].id != 0, "Job does not exist");
        jobDetails[jobId].activeNodes = newActiveNodes;
        jobDetails[jobId].lastNodesChangeTimestamp = block.timestamp;
        if (jobDetails[jobId].startTimestamp == 0) {
            jobDetails[jobId].startTimestamp = block.timestamp;
            jobDetails[jobId].lastAllocatedEpoch = getCurrentEpoch() - 1;
            emit JobStarted(jobId, block.timestamp);
        }
        if (newActiveNodes.length == 0) {
            emit JobClosed(jobId, block.timestamp);
            swapRemoveActiveJob(jobId);
            closedJobs.push(jobId);
        }

        emit NodesUpdated(jobId, newActiveNodes);
    }

    // Claim rewards for a node (called from manager)
    function claimRewardsForNode(
        address nodeAddr,
        address nodeOwner
    ) external onlyPoAIManager returns (uint256) {
        uint256 claimableAmount = virtualWalletBalance[nodeAddr];
        require(claimableAmount > 0, "No rewards to claim");

        // Clear the balance
        virtualWalletBalance[nodeAddr] = 0;
        // Remove this node from the rewards list in PoAI Manager
        poaiManager.removeNodeFromRewardsList(nodeAddr);
        // Swap USDC for R1 tokens and send them to the node owner
        uint256 r1TokensToSend = swapUsdcForR1(claimableAmount);
        require(r1TokensToSend > 0, "Swap failed");
        r1Token.transfer(nodeOwner, r1TokensToSend);

        emit RewardsClaimedV2(
            nodeAddr,
            nodeOwner,
            claimableAmount,
            r1TokensToSend
        );
        return claimableAmount;
    }

    // Allocate rewards to active nodes for all jobs (called from PoAI Manager)
    function allocateRewardsToNodes() external onlyPoAIManager {
        uint256 lastEpoch = getCurrentEpoch() - 1;
        uint256 totalAmountToBurn = 0;

        // Iterate through all jobs
        for (uint256 i = 0; i < activeJobs.length; i++) {
            uint256 jobId = activeJobs[i];
            JobDetails storage job = jobDetails[jobId];
            uint256 lastAllocatedEpoch = job.lastAllocatedEpoch;
            // Finish the loop if job ID is not set (no more jobs)
            if (job.id == 0) {
                //TODO this is not correct
                break;
            }
            // Skip if job has no active nodes
            if (job.activeNodes.length == 0) {
                continue;
            }
            // Skip if we've already allocated for this epoch
            if (lastAllocatedEpoch >= lastEpoch) {
                continue;
            }
            uint256 epochsToAllocate = lastEpoch - lastAllocatedEpoch;
            // Skip if job has ended
            if (
                lastAllocatedEpoch + epochsToAllocate > job.lastExecutionEpoch
            ) {
                if (job.lastExecutionEpoch < lastAllocatedEpoch) {
                    epochsToAllocate = 0;
                } else {
                    epochsToAllocate =
                        job.lastExecutionEpoch -
                        lastAllocatedEpoch;
                }
            }
            if (epochsToAllocate == 0) {
                continue;
            }

            // Calculate reward per node for this epoch
            uint256 rewardPerNode = job.pricePerEpoch * epochsToAllocate;
            uint256 amountToBurnPerNode = (rewardPerNode * BURN_PERCENTAGE) /
                100;
            uint256 amountRewardsPerNode = rewardPerNode - amountToBurnPerNode;
            uint256 totalRewardsToNodes = amountRewardsPerNode *
                job.activeNodes.length;
            uint256 jobAmountToBurn = amountToBurnPerNode *
                job.activeNodes.length;
            INDContract ndContract = INDContract(
                address(controller.ndContract())
            );
            for (uint256 j = 0; j < job.activeNodes.length; j++) {
                address nodeAddress = job.activeNodes[j];
                virtualWalletBalance[nodeAddress] += amountRewardsPerNode;
                // Register node with rewards in PoAI Manager
                poaiManager.registerNodeWithRewards(nodeAddress);
                // Emit event for rewards allocation
                address nodeOwner = ndContract.getNodeOwner(nodeAddress);
                emit RewardsAllocatedV2(
                    jobId,
                    nodeAddress,
                    nodeOwner,
                    amountRewardsPerNode
                );
            }

            // Add to total burn amount
            totalAmountToBurn += jobAmountToBurn;
            // Update job balance and last allocated epoch
            job.balance -= int256(totalRewardsToNodes + jobAmountToBurn);
            job.lastAllocatedEpoch = lastEpoch;

            require(job.balance >= 0, "No balance left"); //TODO will change in V2
        }

        // Burn 15% of total rewards by swapping USDC for R1 and burning R1
        if (totalAmountToBurn > 0) {
            uint256 r1TokensToBurn = swapUsdcForR1(totalAmountToBurn);
            require(r1TokensToBurn > 0, "No R1 tokens to burn");
            r1Token.burn(address(this), r1TokensToBurn);
            emit TokensBurned(totalAmountToBurn, r1TokensToBurn);
        }
    }

    function reconcileJobsBalance() public onlyPoAIManager {
        /*
        Reconcile job balances in storage with real balances.
        This function is needed because a previous version of the contract
        didn't subtract the burn amount from the job balance.
        */
        for (uint256 i = 0; i < activeJobs.length; i++) {
            uint256 jobId = activeJobs[i];
            JobDetails storage job = jobDetails[jobId];
            require(job.id != 0, "Job does not exist");
            require(job.balance >= 0, "Negative job balance");

            if (job.startTimestamp == 0) {
                continue;
            }
            uint256 startEpoch = _calculateEpoch(job.startTimestamp);
            uint256 numberOfEpochsDistributed = job.lastAllocatedEpoch -
                startEpoch +
                1;
            if (numberOfEpochsDistributed == 0) {
                continue;
            }
            uint256 distributedRewards = job.pricePerEpoch *
                job.numberOfNodesRequested *
                numberOfEpochsDistributed;

            uint256 burnCorrection = (distributedRewards * BURN_PERCENTAGE) /
                100;
            require(
                int256(burnCorrection) <= job.balance,
                "Burn exceeds balance"
            );

            job.balance -= int256(burnCorrection);
            emit JobBalanceReconciled(jobId, burnCorrection);
        }
    }

    // Swap USDC for R1 tokens using Uniswap
    function swapUsdcForR1(uint256 amount) private returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = usdcToken;
        path[1] = address(r1Token);

        IERC20(usdcToken).approve(address(uniswapV2Router), amount);
        uint256[] memory amounts = uniswapV2Router.swapExactTokensForTokens(
            amount, // Amount of tokens to swap
            0, // Minimum amount of tokens to receive
            path, // Path of tokens to swap
            address(this), // Address to receive the swapped tokens
            block.timestamp // Deadline
        );
        return amounts[1];
    }

    //.##.....##.####.########.##......##..######.
    //.##.....##..##..##.......##..##..##.##....##
    //.##.....##..##..##.......##..##..##.##......
    //.##.....##..##..######...##..##..##..######.
    //..##...##...##..##.......##..##..##.......##
    //...##.##....##..##.......##..##..##.##....##
    //....###....####.########..###..###...######.

    // Get total balance across all jobs
    function getTotalJobsBalance() external view returns (int256 totalBalance) {
        for (uint256 i = 0; i < activeJobs.length; i++) {
            totalBalance += jobDetails[activeJobs[i]].balance;
        }
    }

    // Get job details by job ID
    function getJobDetails(
        uint256 jobId
    ) external view returns (JobDetails memory) {
        return jobDetails[jobId];
    }

    function getActiveJobs() external view returns (JobDetails[] memory) {
        JobDetails[] memory jobs = new JobDetails[](activeJobs.length);
        for (uint256 i = 0; i < activeJobs.length; i++) {
            jobs[i] = jobDetails[activeJobs[i]];
        }
        return jobs;
    }

    function getClosedJobs() external view returns (JobDetails[] memory) {
        JobDetails[] memory jobs = new JobDetails[](closedJobs.length);
        for (uint256 i = 0; i < closedJobs.length; i++) {
            jobs[i] = jobDetails[closedJobs[i]];
        }
        return jobs;
    }

    function getFirstClosableJobId() external view returns (uint256) {
        uint256 currentEpoch = getCurrentEpoch();
        for (uint256 i = 0; i < activeJobs.length; i++) {
            uint256 jobId = activeJobs[i];
            JobDetails storage job = jobDetails[jobId];
            if (
                job.id != 0 &&
                job.activeNodes.length > 0 &&
                job.lastExecutionEpoch <= currentEpoch
            ) {
                return jobId;
            }
        }
        return 0;
    }

    //.####.##....##.########.########.########..##....##....###....##......
    //..##..###...##....##....##.......##.....##.###...##...##.##...##......
    //..##..####..##....##....##.......##.....##.####..##..##...##..##......
    //..##..##.##.##....##....######...########..##.##.##.##.....##.##......
    //..##..##..####....##....##.......##...##...##..####.#########.##......
    //..##..##...###....##....##.......##....##..##...###.##.....##.##......
    //.####.##....##....##....########.##.....##.##....##.##.....##.########

    function getCurrentEpoch() public view returns (uint256) {
        return _calculateEpoch(block.timestamp);
    }

    function _calculateEpoch(uint256 timestamp) private view returns (uint256) {
        uint256 startEpochTimestamp = controller.startEpochTimestamp();
        uint256 epochDuration = controller.epochDuration();
        require(
            timestamp >= startEpochTimestamp,
            "Timestamp is before the start epoch."
        );

        return (timestamp - startEpochTimestamp) / epochDuration;
    }

    modifier onlyCspOwner() {
        require(msg.sender == cspOwner, "Not CSP owner");
        _;
    }

    modifier onlyPoAIManager() {
        require(msg.sender == address(poaiManager), "Not PoAI Manager");
        _;
    }

    modifier onlyOracle() {
        address[] memory oracles = controller.getOracles();
        require(_isOracle(msg.sender, oracles), "Not an oracle");
        _;
    }

    // Internal helper to check if a node address is in the oracles array
    function _isOracle(
        address node,
        address[] memory oracles
    ) private pure returns (bool) {
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i] == node) {
                return true;
            }
        }
        return false;
    }

    function swapRemoveActiveJob(uint256 jobId) internal {
        // Remove jobId from activeJobs array
        for (uint256 i = 0; i < activeJobs.length; i++) {
            if (activeJobs[i] == jobId) {
                activeJobs[i] = activeJobs[activeJobs.length - 1];
                activeJobs.pop();
                break;
            }
        }
    }

    // Get price for job type (pure function, no storage) - prices in USDC (6 decimals)
    function getPriceForJobType(uint256 jobType) public pure returns (uint256) {
        if (jobType == JOB_TYPE_ENTRY) return 375_000; // $11.25/month
        if (jobType == JOB_TYPE_LOW1) return 750_000; // $22.5/month
        if (jobType == JOB_TYPE_LOW2) return 1_000_000; // $30/month
        if (jobType == JOB_TYPE_MED1) return 1_916_666; // $57.5/month
        if (jobType == JOB_TYPE_MED2) return 2_916_666; // $87.5/month
        if (jobType == JOB_TYPE_HIGH1) return 3_750_000; // $112.5/month
        if (jobType == JOB_TYPE_HIGH2) return 5_333_333; // $160/month
        if (jobType == JOB_TYPE_ULTRA1) return 8_333_333; // $250/month
        if (jobType == JOB_TYPE_ULTRA2) return 12_500_000; // $375/month

        // Services
        if (jobType == JOB_TYPE_PGSQL_LOW) return 1_000_000; // $30/month
        if (jobType == JOB_TYPE_PGSQL_MED) return 2_166_666; // $65/month
        if (jobType == JOB_TYPE_MYSQL_LOW) return 1_000_000; // $30/month
        if (jobType == JOB_TYPE_MYSQL_MED) return 2_166_666; // $65/month
        if (jobType == JOB_TYPE_NOSQL_LOW) return 1_000_000; // $30/month
        if (jobType == JOB_TYPE_NOSQL_MED) return 2_166_666; // $65/month

        // Native Apps
        if (jobType == JOB_TYPE_N_ENTRY) return 2_500_000; // $75/month
        if (jobType == JOB_TYPE_N_MED1) return 3_750_000; // $112.5/month
        if (jobType == JOB_TYPE_N_MED2) return 6_000_000; // $180/month
        if (jobType == JOB_TYPE_N_HIGH) return 9_000_000; // $270/month
        if (jobType == JOB_TYPE_N_ULTRA) return 13_333_333; // $400/month

        // GPU Apps
        if (jobType == JOB_TYPE_G_ENTRY_MED1) return 3_116_666; // $57.5 + $36 = $93.5/month
        if (jobType == JOB_TYPE_G_ENTRY_MED2) return 4_116_666; // $87.5 + $36 = $123.5/month
        if (jobType == JOB_TYPE_G_ENTRY_N_ENTRY) return 3_700_000; // $75 + $36 = $111/month
        if (jobType == JOB_TYPE_G_ENTRY_N_MED1) return 4_950_000; // $112.5 + $36 = $148.5/month

        if (jobType == JOB_TYPE_G_MED_MED2) return 5_316_666; // $87.5 + $72 = $159.5/month
        if (jobType == JOB_TYPE_G_MED_HIGH1) return 6_150_000; // $112.5 + $72 = $184.5/month
        if (jobType == JOB_TYPE_G_MED_HIGH2) return 7_733_333; // $160 + $72 = $232/month
        if (jobType == JOB_TYPE_G_MED_ULTRA1) return 10_733_333; // $250 + $72 = $322/month
        if (jobType == JOB_TYPE_G_MED_N_MED1) return 6_150_000; // $112.5 + $72 = $184.5/month
        if (jobType == JOB_TYPE_G_MED_N_MED2) return 8_400_000; // $180 + $72 = $252/month
        if (jobType == JOB_TYPE_G_MED_N_HIGH) return 11_400_000; // $270 + $72 = $342/month

        if (jobType == JOB_TYPE_G_HIGH_HIGH2) return 10_133_333; // $160 + $144 = $304/month
        if (jobType == JOB_TYPE_G_HIGH_ULTRA1) return 13_133_333; // $250 + $144 = $394/month
        if (jobType == JOB_TYPE_G_HIGH_ULTRA2) return 17_300_000; // $375 + $144 = $519/month
        if (jobType == JOB_TYPE_G_HIGH_N_MED2) return 10_800_000; // $180 + $144 = $324/month
        if (jobType == JOB_TYPE_G_HIGH_N_HIGH) return 13_800_000; // $270 + $144 = $414/month
        if (jobType == JOB_TYPE_G_HIGH_N_ULTRA) return 18_133_333; // $400 + $144 = $544/month

        if (jobType == JOB_TYPE_G_ULTRA_ULTRA1) return 38_333_333; // $250 + $900 = $1150/month
        if (jobType == JOB_TYPE_G_ULTRA_ULTRA2) return 42_500_000; // $375 + $900 = $1275/month
        if (jobType == JOB_TYPE_G_ULTRA_N_ULTRA) return 43_333_333; // $400 + $900 = $1300/month

        revert("Invalid job type");
    }
}
