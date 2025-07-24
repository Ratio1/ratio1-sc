// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./Controller.sol";

interface IPoAIManager {
    function getNewJobId() external returns (uint256);
}

//TODO research if we can optimize this struct
struct JobDetails {
    uint256 id;
    uint256 requestTimestamp;
    uint256 startTimestamp;
    uint256 lastNodesChangeTimestamp;
    uint256 jobType;
    uint256 price;
    uint256 lastExecutionEpoch;
    uint256 numberOfNodesRequested;
    int256 balance;
    address[] activeNodes;
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
    address public r1Token;
    Controller public controller;
    IUniswapV2Router02 public uniswapV2Router;
    IUniswapV2Pair public uniswapV2Pair;

    mapping(uint256 => JobDetails) public jobDetails;
    mapping(address => uint256) public virtualWalletBalance;

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
        r1Token = _r1Token;
        controller = Controller(_controller);
        uniswapV2Router = IUniswapV2Router02(_uniswapV2Router);
        uniswapV2Pair = IUniswapV2Pair(_uniswapV2Pair);
    }

    function createJob(
        uint256 jobType,
        uint256 lastExecutionEpoch,
        uint256 numberOfNodesRequested
    ) external onlyCspOwner {
        uint256 currentEpoch = getCurrentEpoch();
        uint256 numberOfEpochs = lastExecutionEpoch - currentEpoch;
        uint256 price = 1 * numberOfNodesRequested * numberOfEpochs; //TODO use real prices table
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
            lastNodesChangeTimestamp: 0,
            jobType: jobType,
            price: price,
            lastExecutionEpoch: lastExecutionEpoch,
            numberOfNodesRequested: numberOfNodesRequested,
            balance: int256(price),
            activeNodes: new address[](0)
        });
        emit JobCreated(jobId, cspOwner, jobType, price);
    }

    // Receive consensus-based updates from PoAI Manager
    function updateActiveNodes(
        uint256 jobId,
        address[] memory newActiveNodes
    ) external onlyPoAIManager {
        require(jobDetails[jobId].id != 0, "Job does not exist");
        jobDetails[jobId].activeNodes = newActiveNodes;
        if (jobDetails[jobId].startTimestamp == 0) {
            jobDetails[jobId].startTimestamp = block.timestamp;
            emit JobStarted(jobId, block.timestamp);
        }

        emit NodesUpdated(jobId, newActiveNodes);
    }

    // Claim rewards for a node (called from manager)
    function claimRewardsForNode(
        address nodeAddr
    ) external onlyPoAIManager returns (uint256) {
        // TODO: Iterate over allocated rewards, calculate amounts, clear storage
        return 0; // placeholder
    }

    // Swap USDC for R1 tokens using Uniswap
    function swapUsdcForR1(uint256 amount) private returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = usdcToken;
        path[1] = r1Token;

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
}
