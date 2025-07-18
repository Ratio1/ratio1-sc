// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

// TODO Interface for CSP Escrow contract (to be defined)
interface ICspEscrow {
    function updateActiveNodes(
        uint256 jobId,
        address[] memory activeNodes
    ) external;
}

// NDLicense and MNDLicense structs as in Reader
struct NDLicense {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 remainingAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
    uint256 assignTimestamp;
    address lastClaimOracle;
    bool isBanned;
}

struct MNDLicense {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 firstMiningEpoch;
    uint256 remainingAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
    uint256 assignTimestamp;
    address lastClaimOracle;
}

interface IND {
    function getLicenses(
        address owner
    ) external view returns (NDLicense[] memory);
}

interface IMND {
    function getLicenses(
        address owner
    ) external view returns (MNDLicense[] memory);
}

interface IController {
    function getOracles() external view returns (address[] memory);
}

contract PoAIManager is Initializable, OwnableUpgradeable {
    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    // Address of the UpgradeableBeacon for CSP Escrow contracts
    UpgradeableBeacon public cspEscrowBeacon;
    IND public ndContract;
    IMND public mndContract;
    IController public controller;
    address public usdcToken;
    address public r1Token;
    address public uniswapV2Router;
    address public uniswapV2Pair;

    uint256 public nextJobId;

    // Array of all deployed CSP Escrow addresses
    address[] public allEscrows;
    // Mapping from owner address to their CSP Escrow address
    mapping(address => address) public ownerToEscrow;
    // Mapping from CSP Escrow address to owner address
    mapping(address => address) public escrowToOwner;
    // Mapping from Job ID to CSP Escrow address
    mapping(uint256 => address) public jobIdToEscrow;
    // Mapping from node address to array of escrow addresses with allocated rewards
    mapping(address => address[]) public nodeToEscrowsWithRewards;

    // Consensus mechanism for node updates
    // Mapping from job ID to oracle submissions (oracle => active nodes hash)
    mapping(uint256 => mapping(address => bytes32))
        public oracleNodeSubmissions;
    // Mapping from job ID to submission count
    mapping(uint256 => uint256) public jobSubmissionCount;
    // Mapping from job ID to consensus reached flag
    mapping(uint256 => bool) public jobConsensusReached;
    // Mapping from job ID to hash counts for consensus optimization
    mapping(uint256 => mapping(bytes32 => uint256)) public jobHashCounts;
    // Mapping from job ID to most common hash and its count
    mapping(uint256 => bytes32) public jobMostCommonHash;
    mapping(uint256 => uint256) public jobMostCommonHashCount;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event EscrowDeployed(address indexed owner, address escrow);
    event JobRegistered(uint256 indexed jobId, address indexed escrow);
    event RewardsClaimed(address indexed nodeOwner, uint256 totalAmount);
    event NodeUpdateSubmitted(
        uint256 indexed jobId,
        address indexed oracle,
        bytes32 nodesHash
    );
    event ConsensusReached(uint256 indexed jobId, address[] activeNodes);

    //.########.##....##.########..########...#######..####.##....##.########..######.
    //.##.......###...##.##.....##.##.....##.##.....##..##..###...##....##....##....##
    //.##.......####..##.##.....##.##.....##.##.....##..##..####..##....##....##......
    //.######...##.##.##.##.....##.########..##.....##..##..##.##.##....##.....######.
    //.##.......##..####.##.....##.##........##.....##..##..##..####....##..........##
    //.##.......##...###.##.....##.##........##.....##..##..##...###....##....##....##
    //.########.##....##.########..##.........#######..####.##....##....##.....######.

    function initialize(
        address _cspEscrowImplementation,
        address _ndContract,
        address _mndContract,
        address _controller,
        address _usdcToken,
        address _r1Token,
        address _uniswapV2Router,
        address _uniswapV2Pair,
        address newOwner
    ) public initializer {
        __Ownable_init(newOwner);
        cspEscrowBeacon = new UpgradeableBeacon(
            _cspEscrowImplementation,
            newOwner
        );
        ndContract = IND(_ndContract);
        mndContract = IMND(_mndContract);
        controller = IController(_controller);
        usdcToken = _usdcToken;
        r1Token = _r1Token;
        uniswapV2Router = _uniswapV2Router;
        uniswapV2Pair = _uniswapV2Pair;
        nextJobId = 1;
    }

    // Deploy a new CSP Escrow contract for a given owner
    function deployCspEscrow() external {
        address sender = msg.sender;
        require(ownerToEscrow[sender] == address(0), "Already has escrow");
        require(_hasOracleNode(sender), "No oracle node owned");
        // Deploy BeaconProxy for the new CSP Escrow
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,address,address,address)",
            sender,
            address(this),
            usdcToken,
            r1Token,
            address(controller),
            uniswapV2Router,
            uniswapV2Pair
        );
        BeaconProxy proxy = new BeaconProxy(address(cspEscrowBeacon), data);
        address escrowAddr = address(proxy);
        allEscrows.push(escrowAddr);
        ownerToEscrow[sender] = escrowAddr;
        escrowToOwner[escrowAddr] = sender;
        emit EscrowDeployed(sender, escrowAddr);
    }

    // Internal function to check if user owns at least one ND or MND with a linked node address that is an oracle
    function _hasOracleNode(address user) internal view returns (bool) {
        address[] memory oracles = controller.getOracles();
        // Check MND licenses
        MNDLicense[] memory mndLicenses = mndContract.getLicenses(user);
        for (uint256 i = 0; i < mndLicenses.length; i++) {
            address nodeAddr = mndLicenses[i].nodeAddress;
            if (nodeAddr != address(0) && _isOracle(nodeAddr, oracles)) {
                return true;
            }
        }
        // Check ND licenses
        NDLicense[] memory ndLicenses = ndContract.getLicenses(user);
        for (uint256 i = 0; i < ndLicenses.length; i++) {
            address nodeAddr = ndLicenses[i].nodeAddress;
            if (nodeAddr != address(0) && _isOracle(nodeAddr, oracles)) {
                return true;
            }
        }
        return false;
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

    // Claim rewards for a node owner across all CSPs
    function claimRewardsForNode(address nodeOwner) external {
        // TODO: Iterate over nodeToCSPsWithUnclaimedRewards, call claim on each CSP Escrow
    }

    // Submit node update for consensus (called by oracles)
    function submitNodeUpdate(
        uint256 jobId,
        address[] memory activeNodes
    ) external onlyOracle {
        address[] memory oracles = controller.getOracles();
        address sender = msg.sender;

        // Early validation checks
        require(jobIdToEscrow[jobId] != address(0), "Job does not exist");
        require(
            oracleNodeSubmissions[jobId][sender] == bytes32(0),
            "Already submitted"
        );

        // Early return if consensus already reached
        if (jobConsensusReached[jobId]) {
            return;
        }

        // Calculate hash of the active nodes array
        bytes32 nodesHash = keccak256(abi.encode(activeNodes));

        // Store the submission
        oracleNodeSubmissions[jobId][sender] = nodesHash;
        jobSubmissionCount[jobId]++;

        // Update hash count for consensus optimization
        jobHashCounts[jobId][nodesHash]++;

        // Update most common hash if this hash now has more occurrences
        if (jobHashCounts[jobId][nodesHash] > jobMostCommonHashCount[jobId]) {
            jobMostCommonHash[jobId] = nodesHash;
            jobMostCommonHashCount[jobId] = jobHashCounts[jobId][nodesHash];
        }

        emit NodeUpdateSubmitted(jobId, sender, nodesHash);

        // Check if we have enough submissions to attempt consensus
        uint256 requiredSubmissions = (oracles.length / 2) + 1; // 50% + 1
        if (jobSubmissionCount[jobId] >= requiredSubmissions) {
            _attemptConsensus(jobId, activeNodes, oracles);
        }
    }

    function _attemptConsensus(
        uint256 jobId,
        address[] memory activeNodes,
        address[] memory oracles
    ) internal {
        // Use pre-calculated most common hash for O(1) consensus
        bytes32 mostCommonHash = jobMostCommonHash[jobId];
        uint256 maxCount = jobMostCommonHashCount[jobId];

        // Check if we have enough consensus (33% + 1, but minimum 2 oracles)
        uint256 requiredConsensus = (oracles.length / 3) + 1;
        if (requiredConsensus < 2) {
            requiredConsensus = 2;
        }

        if (maxCount >= requiredConsensus) {
            jobConsensusReached[jobId] = true;
            address escrowAddress = jobIdToEscrow[jobId];
            ICspEscrow(escrowAddress).updateActiveNodes(jobId, activeNodes);
            emit ConsensusReached(jobId, activeNodes);
        }
    }

    // View function to check consensus status
    function getConsensusStatus(
        uint256 jobId
    ) external view returns (bool consensusReached, uint256 submissionCount) {
        return (jobConsensusReached[jobId], jobSubmissionCount[jobId]);
    }

    // View function to get oracle submission for a job
    function getOracleSubmission(
        uint256 jobId,
        address oracle
    ) external view returns (bool hasSubmitted, bytes32 nodesHash) {
        hasSubmitted = oracleNodeSubmissions[jobId][oracle] != bytes32(0);
        nodesHash = oracleNodeSubmissions[jobId][oracle];
    }

    function getNewJobId() external onlyCspEscrow returns (uint256) {
        uint256 newJobId = nextJobId;
        nextJobId++;
        jobIdToEscrow[newJobId] = msg.sender;
        return newJobId;
    }

    // View function to get job details by job ID
    function getJobDetails(uint256 jobId) external view returns (address) {
        return jobIdToEscrow[jobId];
        // TODO: Fetch from correct CSP Escrow
    }

    modifier onlyOracle() {
        address[] memory oracles = controller.getOracles();
        require(_isOracle(msg.sender, oracles), "Not an oracle");
        _;
    }

    modifier onlyCspEscrow() {
        require(escrowToOwner[msg.sender] != address(0), "Not a CSP Escrow");
        _;
    }
}
