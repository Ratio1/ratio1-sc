// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

// TODO Interface for CSP Escrow contract (to be defined)
interface ICspEscrow {
    // function stubs for interaction
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
    // Mapping for epoch consensus submissions (oracle => epoch => table hash)
    //TODO decide how to do mapping(address => mapping(uint256 => bytes32)) public oracleEpochTables;

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
    //TODO event ConsensusReached(uint256 epoch, bytes32 tableHash);

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
        nextJobId = 1;
    }

    // Deploy a new CSP Escrow contract for a given owner
    function deployCspEscrow() external {
        address sender = msg.sender;
        require(ownerToEscrow[sender] == address(0), "Already has escrow");
        require(_hasOracleNode(sender), "No oracle node owned");
        // Deploy BeaconProxy for the new CSP Escrow
        bytes memory data = abi.encodeWithSignature(
            "initialize(address,address,address,address,address)",
            sender,
            address(this),
            usdcToken,
            r1Token,
            address(controller)
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
        require(
            ownerToEscrow[escrowToOwner[msg.sender]] != address(0),
            "Not a CSP Escrow"
        );
        _;
    }
}
