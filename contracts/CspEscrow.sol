// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPoAIManager {
    function getNewJobId() external returns (uint256);
}

interface IController {
    function getOracles() external view returns (address[] memory);
}

//TODO research if we can optimize this struct
struct JobDetails {
    uint256 id;
    uint256 requestTimestamp;
    uint256 startTimestamp;
    uint256 jobType;
    uint256 price;
    uint256 numberOfEpochs;
    uint256 numberOfNodesRequested;
    address[] activeNodes;
}

struct AllocatedReward {
    uint256 jobId;
    uint256 epoch;
}

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
    address public r1Token;
    IController public controller;

    // Job details: job id -> JobDetails
    mapping(uint256 => JobDetails) public jobDetails;
    // Claim tracking: job id -> epoch -> node_addr -> boolean
    mapping(uint256 => mapping(uint256 => mapping(address => bool)))
        public hasClaimed;
    // Participation tracking: job id -> epoch -> Array<node_addr>
    mapping(uint256 => mapping(uint256 => address[])) public participatingNodes;
    // Allocated rewards: node_addr -> Array<AllocatedReward>
    mapping(address => AllocatedReward[]) public allocatedRewards;

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
        uint256 price
    );
    event JobStarted(uint256 indexed jobId, uint256 startTimestamp);
    event NodesUpdated(uint256 indexed jobId, address[] activeNodes);
    event RewardsClaimed(address indexed nodeOwner, uint256 totalAmount);

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
        address _controller
    ) public initializer {
        require(_usdcToken != address(0), "USDC token cannot be zero address");
        require(_r1Token != address(0), "R1 token cannot be zero address");
        require(_controller != address(0), "Controller cannot be zero address");
        cspOwner = _cspOwner;
        poaiManager = IPoAIManager(_poaiManager);
        usdcToken = _usdcToken;
        r1Token = _r1Token;
        controller = IController(_controller);
    }

    function createJob(
        uint256 jobType,
        uint256 price,
        uint256 numberOfEpochs,
        uint256 numberOfNodesRequested
    ) external onlyCspOwner {
        require(price > 0, "Price must be greater than 0"); //TODO should check price from prices table
        require(
            numberOfEpochs > 30,
            "Number of epochs must be greater than 30"
        ); //TODO check
        require(
            numberOfNodesRequested > 0,
            "Number of nodes must be greater than 0"
        ); //TODO for some jobs should be 1?

        uint256 jobId = poaiManager.getNewJobId();

        // Transfer USDC from CSP owner to escrow
        IERC20(usdcToken).transferFrom(msg.sender, address(this), price);

        jobDetails[jobId] = JobDetails({
            id: jobId,
            requestTimestamp: block.timestamp,
            startTimestamp: 0,
            jobType: jobType,
            price: price,
            numberOfEpochs: numberOfEpochs,
            numberOfNodesRequested: numberOfNodesRequested,
            activeNodes: new address[](0)
        });
        emit JobCreated(jobId, cspOwner, jobType, price);
    }

    // Receive real-time updates from oracles
    function updateActiveNodes(
        uint256 jobId,
        address[] memory activeNodes
    ) external onlyOracle {
        require(jobDetails[jobId].id != 0, "Job does not exist");
        jobDetails[jobId].activeNodes = activeNodes;
        if (jobDetails[jobId].startTimestamp == 0) {
            jobDetails[jobId].startTimestamp = block.timestamp;
            emit JobStarted(jobId, block.timestamp);
        }

        emit NodesUpdated(jobId, activeNodes);
    }

    // Claim rewards for a node (called from manager)
    function claimRewardsForNode(
        address nodeAddr
    ) external onlyPoAIManager returns (uint256) {
        // TODO: Iterate over allocated rewards, calculate amounts, clear storage
        return 0; // placeholder
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

    // Get allocated rewards for a node
    function getAllocatedRewards(
        address node
    ) external view returns (AllocatedReward[] memory) {
        return allocatedRewards[node];
    }

    // Get participating nodes for a job epoch
    function getParticipatingNodes(
        uint256 jobId,
        uint256 epoch
    ) external view returns (address[] memory) {
        return participatingNodes[jobId][epoch];
    }

    // Check if a node has claimed rewards for a specific job-epoch
    function hasNodeClaimed(
        uint256 jobId,
        uint256 epoch,
        address node
    ) external view returns (bool) {
        return hasClaimed[jobId][epoch][node];
    }

    //.####.##....##.########.########.########..##....##....###....##......
    //..##..###...##....##....##.......##.....##.###...##...##.##...##......
    //..##..####..##....##....##.......##.....##.####..##..##...##..##......
    //..##..##.##.##....##....######...########..##.##.##.##.....##.##......
    //..##..##..####....##....##.......##...##...##..####.#########.##......
    //..##..##...###....##....##.......##....##..##...###.##.....##.##......
    //.####.##....##....##....########.##.....##.##....##.##.....##.########

    // Internal function to calculate rewards for a node
    function _calculateNodeRewards(
        address node,
        uint256 jobId,
        uint256 epoch
    ) internal view returns (uint256) {
        // TODO: Calculate reward amount based on job price and participation
        return 0; // placeholder
    }

    // Internal function to swap USDC to R1 and distribute
    function _swapAndDistributeRewards(
        uint256 usdcAmount,
        address nodeOwner
    ) internal returns (uint256) {
        // TODO: Swap USDC to R1, burn 15%, send 85% to node owner
        return 0; // placeholder
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
}
