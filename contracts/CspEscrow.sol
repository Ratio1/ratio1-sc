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
uint256 constant JOB_TYPE_G_ENTRY_HIGH1 = 23;
uint256 constant JOB_TYPE_G_ENTRY_HIGH2 = 24;
uint256 constant JOB_TYPE_G_ENTRY_ULTRA1 = 25;
uint256 constant JOB_TYPE_G_ENTRY_ULTRA2 = 26;
uint256 constant JOB_TYPE_G_ENTRY_N_ENTRY = 27;
uint256 constant JOB_TYPE_G_ENTRY_N_MED1 = 28;
uint256 constant JOB_TYPE_G_ENTRY_N_MED2 = 29;
uint256 constant JOB_TYPE_G_ENTRY_N_HIGH = 30;
uint256 constant JOB_TYPE_G_ENTRY_N_ULTRA = 31;

uint256 constant JOB_TYPE_G_MED_MED2 = 32;
uint256 constant JOB_TYPE_G_MED_HIGH1 = 33;
uint256 constant JOB_TYPE_G_MED_HIGH2 = 34;
uint256 constant JOB_TYPE_G_MED_ULTRA1 = 35;
uint256 constant JOB_TYPE_G_MED_ULTRA2 = 36;
uint256 constant JOB_TYPE_G_MED_N_MED1 = 37;
uint256 constant JOB_TYPE_G_MED_N_MED2 = 38;
uint256 constant JOB_TYPE_G_MED_N_HIGH = 39;
uint256 constant JOB_TYPE_G_MED_N_ULTRA = 40;

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

    uint256[] public allJobs;

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
            allJobs.push(jobId);
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
        //TODO add a new mapping with the list of oracles that participated in this update consensus
        if (jobDetails[jobId].startTimestamp == 0) {
            jobDetails[jobId].startTimestamp = block.timestamp;
            jobDetails[jobId].lastAllocatedEpoch = getCurrentEpoch() - 1;
            emit JobStarted(jobId, block.timestamp);
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
        for (uint256 i = 0; i < allJobs.length; i++) {
            uint256 jobId = allJobs[i];
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

            INDContract ndContract = INDContract(
                address(controller.ndContract())
            );

            // Calculate reward per node for this epoch
            uint256 rewardPerNode = job.pricePerEpoch * epochsToAllocate;
            uint256 amountToBurnPerNode = (rewardPerNode * BURN_PERCENTAGE) /
                100;
            uint256 amountRewardsPerNode = rewardPerNode - amountToBurnPerNode;
            uint256 totalRewardsToNodes = amountRewardsPerNode *
                job.activeNodes.length;
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
                    totalRewardsToNodes
                );
            }

            // Add to total burn amount
            totalAmountToBurn += amountToBurnPerNode * job.activeNodes.length;
            // Update job balance and last allocated epoch
            job.balance -= int256(totalRewardsToNodes);
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

    // Get job details by job ID
    function getJobDetails(
        uint256 jobId
    ) external view returns (JobDetails memory) {
        return jobDetails[jobId];
    }

    function getAllJobs() external view returns (JobDetails[] memory) {
        JobDetails[] memory jobs = new JobDetails[](allJobs.length);
        for (uint256 i = 0; i < allJobs.length; i++) {
            jobs[i] = jobDetails[allJobs[i]];
        }
        return jobs;
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

    // Get price for job type (pure function, no storage) - prices in USDC (6 decimals)
    function getPriceForJobType(uint256 jobType) public pure returns (uint256) {
        if (jobType == JOB_TYPE_ENTRY) return 375000; // $11.25/month
        if (jobType == JOB_TYPE_LOW1) return 750000; // $22.5/month
        if (jobType == JOB_TYPE_LOW2) return 1000000; // $30/month
        if (jobType == JOB_TYPE_MED1) return 1916666; // $57.5/month
        if (jobType == JOB_TYPE_MED2) return 2916666; // $87.5/month
        if (jobType == JOB_TYPE_HIGH1) return 3750000; // $112.5/month
        if (jobType == JOB_TYPE_HIGH2) return 5333333; // $160/month
        if (jobType == JOB_TYPE_ULTRA1) return 8333333; // $250/month
        if (jobType == JOB_TYPE_ULTRA2) return 12500000; // $375/month

        // Services
        if (jobType == JOB_TYPE_PGSQL_LOW) return 1000000; // $30/month
        if (jobType == JOB_TYPE_PGSQL_MED) return 2166666; // $65/month
        if (jobType == JOB_TYPE_MYSQL_LOW) return 1000000; // $30/month
        if (jobType == JOB_TYPE_MYSQL_MED) return 2166666; // $65/month
        if (jobType == JOB_TYPE_NOSQL_LOW) return 1000000; // $30/month
        if (jobType == JOB_TYPE_NOSQL_MED) return 2166666; // $65/month

        // Native Apps
        if (jobType == JOB_TYPE_N_ENTRY) return 2500000; // $75/month
        if (jobType == JOB_TYPE_N_MED1) return 3750000; // $112.5/month
        if (jobType == JOB_TYPE_N_MED2) return 6000000; // $180/month
        if (jobType == JOB_TYPE_N_HIGH) return 9000000; // $270/month
        if (jobType == JOB_TYPE_N_ULTRA) return 13333333; // $400/month

        // GPU Apps
        if (jobType == JOB_TYPE_G_ENTRY_MED1) return 3116666; // $93.5/month
        if (jobType == JOB_TYPE_G_ENTRY_MED2) return 4116666; // $123.5/month
        if (jobType == JOB_TYPE_G_ENTRY_HIGH1) return 4950000; // $148.5/month
        if (jobType == JOB_TYPE_G_ENTRY_HIGH2) return 6533333; // $196/month
        if (jobType == JOB_TYPE_G_ENTRY_ULTRA1) return 9533333; // $286/month
        if (jobType == JOB_TYPE_G_ENTRY_ULTRA2) return 13700000; // $411/month
        if (jobType == JOB_TYPE_G_ENTRY_N_ENTRY) return 3700000; // $111/month
        if (jobType == JOB_TYPE_G_ENTRY_N_MED1) return 4950000; // $148.5/month
        if (jobType == JOB_TYPE_G_ENTRY_N_MED2) return 7200000; // $216/month
        if (jobType == JOB_TYPE_G_ENTRY_N_HIGH) return 10200000; // $306/month
        if (jobType == JOB_TYPE_G_ENTRY_N_ULTRA) return 14533333; // $436/month

        if (jobType == JOB_TYPE_G_MED_MED2) return 5316666; // $159.5/month
        if (jobType == JOB_TYPE_G_MED_HIGH1) return 6150000; // $184.5/month
        if (jobType == JOB_TYPE_G_MED_HIGH2) return 7733333; // $232/month
        if (jobType == JOB_TYPE_G_MED_ULTRA1) return 10733333; // $322/month
        if (jobType == JOB_TYPE_G_MED_ULTRA2) return 14900000; // $447/month
        if (jobType == JOB_TYPE_G_MED_N_MED1) return 4950000; // $148.5/month
        if (jobType == JOB_TYPE_G_MED_N_MED2) return 6533333; // $196/month
        if (jobType == JOB_TYPE_G_MED_N_HIGH) return 9533333; // $286/month
        if (jobType == JOB_TYPE_G_MED_N_ULTRA) return 13700000; // $411/month

        revert("Invalid job type");
    }
}
