// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "./Controller.sol";
import "./CspEscrow.sol";
import "./R1.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

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
    uint256 usdcPoaiRewards;
    uint256 r1PoaiRewards;
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
    function getNodeOwner(address nodeAddress) external view returns (address);
}

interface IMND {
    function getLicenses(
        address owner
    ) external view returns (MNDLicense[] memory);
}

struct NodesTransitionProposal {
    address proposer;
    bytes32 newActiveNodesHash;
}

struct JobWithAllDetails {
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
    address escrowAddress;
    address escrowOwner;
}

struct CspWithOwner {
    address cspAddress;
    address cspOwner;
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
    Controller public controller;
    address public usdcToken;
    address public r1Token;
    address public uniswapV2Router;
    address public uniswapV2Pair;

    uint256 public nextJobId;
    uint256 public lastAllocatedEpoch;
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
    /// jobId => epochId => proposals
    mapping(uint256 => mapping(uint256 => NodesTransitionProposal[]))
        public nodesTransactionProposals;
    // Cache of node sets keyed by jobId and proposal hash
    mapping(uint256 => mapping(bytes32 => address[]))
        private jobIdToNodesByNodesHash;
    // Track which hashes have been stored per job to avoid duplicate pushes
    mapping(uint256 => mapping(bytes32 => bool)) private jobIdNodesHashStored;

    // Array to track unvalidated job IDs (jobs with pending consensus)
    uint256[] public unvalidatedJobIds;
    // Mapping to track if a job is already in the unvalidated list
    mapping(uint256 => bool) public isJobUnvalidated;
    // Mapping to track when consensus was last reached for each job (for cooldown period)
    mapping(uint256 => uint256) public jobConsensusTimestamp;
    // Cooldown period after consensus (5 minutes)
    uint256 public constant CONSENSUS_COOLDOWN_PERIOD = 300;
    bool public hasReconciled;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event EscrowDeployed(address indexed owner, address escrow);
    event JobRegistered(uint256 indexed jobId, address indexed escrow);
    event RewardsClaimed(
        address indexed nodeAddr,
        address indexed nodeOwner,
        uint256 totalAmount
    );
    event NodeUpdateSubmittedV2(
        uint256 indexed jobId,
        address indexed oracle,
        address[] newActiveNodes,
        bytes32 nodesHash
    );
    event ConsensusReachedV2(
        uint256 indexed jobId,
        address[] activeNodes,
        address[] participants
    );
    event ConsensusCooldownEnforced(
        uint256 indexed jobId,
        address indexed oracle,
        uint256 remainingCooldownTime
    );
    event ConsensusNotReached(
        uint256 indexed jobId,
        uint256 oraclesCount,
        uint256 proposalsCount,
        uint256 maxAgreementCount
    );

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
        controller = Controller(_controller);
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
    function claimRewardsForNode(address nodeAddr) external {
        address nodeOwner = ndContract.getNodeOwner(nodeAddr);
        require(nodeOwner == msg.sender, "Not the owner of the node");
        address[] memory escrows = nodeToEscrowsWithRewards[nodeAddr];
        uint256 totalClaimed = 0;

        for (uint256 i = 0; i < escrows.length; i++) {
            address escrowAddress = escrows[i];
            uint256 claimedAmount = CspEscrow(escrowAddress)
                .claimRewardsForNode(nodeAddr, nodeOwner);
            totalClaimed += claimedAmount;
        }

        emit RewardsClaimed(nodeAddr, nodeOwner, totalClaimed);
    }

    function claimRewardsForNodes(address[] memory nodeAddrs) external {
        for (uint256 i = 0; i < nodeAddrs.length; i++) {
            address nodeAddr = nodeAddrs[i];
            address nodeOwner = ndContract.getNodeOwner(nodeAddr);
            require(nodeOwner == msg.sender, "Not the owner of the node");
            address[] memory escrows = nodeToEscrowsWithRewards[nodeAddr];
            uint256 totalClaimed = 0;

            for (uint256 j = 0; j < escrows.length; j++) {
                address escrowAddress = escrows[j];
                uint256 claimedAmount = CspEscrow(escrowAddress)
                    .claimRewardsForNode(nodeAddr, nodeOwner);
                totalClaimed += claimedAmount;
            }
            emit RewardsClaimed(nodeAddr, nodeOwner, totalClaimed);
        }
    }

    // Submit node update for consensus (called by oracles)
    function submitNodeUpdate(
        uint256 jobId,
        address[] memory newActiveNodes
    ) external {
        address sender = msg.sender;
        address[] memory oracles = controller.getOracles();
        require(_isOracle(sender, oracles), "Not an oracle");
        uint256 oraclesCount = oracles.length;
        uint256 currentEpoch = getCurrentEpoch();
        NodesTransitionProposal[] storage proposals = nodesTransactionProposals[
            jobId
        ][currentEpoch];
        address escrowAddress = jobIdToEscrow[jobId];
        require(escrowAddress != address(0), "Job does not exist");
        // Check if the sender is already in the proposals
        for (uint256 i = 0; i < proposals.length; i++) {
            require(proposals[i].proposer != sender, "Already submitted");
        }
        // Check if the nodes are the same as the current active nodes
        bytes32 newActiveNodesHash = keccak256(abi.encode(newActiveNodes));
        address[] memory currentNodes = CspEscrow(escrowAddress)
            .getJobActiveNodes(jobId);
        //do not open a new consensus session if the node is reporting the same nodes (probably a late oracle)
        if (
            !isJobUnvalidated[jobId] &&
            keccak256(abi.encode(currentNodes)) == newActiveNodesHash
        ) {
            return;
        }
        // Check if we're in the cooldown period after consensus
        require(
            block.timestamp - jobConsensusTimestamp[jobId] >=
                CONSENSUS_COOLDOWN_PERIOD,
            "Consensus cooldown not expired"
        );

        _cacheNodesForJob(jobId, newActiveNodesHash, newActiveNodes);
        proposals.push(
            NodesTransitionProposal({
                proposer: sender,
                newActiveNodesHash: newActiveNodesHash
            })
        );

        // Add job to unvalidated list if it's the first proposal
        if (!isJobUnvalidated[jobId]) {
            unvalidatedJobIds.push(jobId);
            isJobUnvalidated[jobId] = true;
        }

        emit NodeUpdateSubmittedV2(
            jobId,
            sender,
            newActiveNodes,
            newActiveNodesHash
        );

        // Check if we have enough submissions to attempt consensus
        uint256 requiredSubmissions = (oraclesCount / 2) + 1; // 50% + 1
        if (proposals.length >= requiredSubmissions) {
            _attemptConsensus(jobId, oraclesCount, proposals);
        }
    }

    function _attemptConsensus(
        uint256 jobId,
        uint256 oraclesCount,
        NodesTransitionProposal[] storage proposals
    ) internal {
        uint256 proposalsLength = proposals.length;
        // Find the most common newActiveNodes
        uint256 maxCount = 0;
        bytes32 mostCommonHash;
        for (uint256 i = 0; i < proposalsLength; i++) {
            NodesTransitionProposal storage proposal = proposals[i];
            // Count occurrences of each newActiveNodes
            uint256 count = 1;
            for (uint256 j = i + 1; j < proposalsLength; j++) {
                if (
                    proposals[j].newActiveNodesHash ==
                    proposal.newActiveNodesHash
                ) {
                    count++;
                }
            }
            // If this is the first or has more occurrences, update the max
            if (count > maxCount) {
                maxCount = count;
                mostCommonHash = proposal.newActiveNodesHash;
            }
        }

        // Check if we have enough consensus (33% + 1)
        uint256 requiredConsensus = (oraclesCount / 3) + 1;
        if (maxCount >= requiredConsensus) {
            require(
                jobIdNodesHashStored[jobId][mostCommonHash],
                "Hash not stored"
            );
            address[] memory mostCommonNewActiveNodes = jobIdToNodesByNodesHash[
                jobId
            ][mostCommonHash];
            // Get participants
            address[] memory participants = new address[](maxCount);
            uint256 addedParticipants = 0;
            for (uint256 i = 0; i < proposalsLength; i++) {
                if (proposals[i].newActiveNodesHash == mostCommonHash) {
                    participants[addedParticipants] = proposals[i].proposer;
                    addedParticipants++;
                }
            }
            emit ConsensusReachedV2(
                jobId,
                mostCommonNewActiveNodes,
                participants
            );
            uint256 currentEpoch = getCurrentEpoch();
            delete nodesTransactionProposals[jobId][currentEpoch];
            delete jobIdToNodesByNodesHash[jobId][mostCommonHash];
            delete jobIdNodesHashStored[jobId][mostCommonHash];
            // Set consensus timestamp for cooldown period
            jobConsensusTimestamp[jobId] = block.timestamp;

            // Remove job from unvalidated list
            _removeJobFromUnvalidatedList(jobId);
            // Update active nodes on the escrow if they are different
            address escrowAddress = jobIdToEscrow[jobId];
            address[] memory currentNodes = CspEscrow(escrowAddress)
                .getJobActiveNodes(jobId);
            if (keccak256(abi.encode(currentNodes)) != mostCommonHash) {
                CspEscrow(escrowAddress).updateActiveNodes(
                    jobId,
                    mostCommonNewActiveNodes
                );
            }
        } else {
            emit ConsensusNotReached(
                jobId,
                oraclesCount,
                proposalsLength,
                maxCount
            );
        }
    }

    // Public function to allocate rewards across all CSP Escrows
    function allocateRewardsAcrossAllEscrows() external {
        uint256 escrowCount = allEscrows.length;
        for (uint256 i = 0; i < escrowCount; i++) {
            address escrowAddress = allEscrows[i];
            CspEscrow(escrowAddress).allocateRewardsToNodes();
        }
        lastAllocatedEpoch = getCurrentEpoch() - 1;
    }

    function getNewJobId() external onlyCspEscrow returns (uint256) {
        uint256 newJobId = nextJobId;
        nextJobId++;
        jobIdToEscrow[newJobId] = msg.sender;
        return newJobId;
    }

    // Register a node that has rewards to claim in a specific escrow
    function registerNodeWithRewards(
        address nodeAddress
    ) external onlyCspEscrow {
        address[] storage escrows = nodeToEscrowsWithRewards[nodeAddress];
        // Check if this escrow is already in the list to avoid duplicates
        for (uint256 i = 0; i < escrows.length; i++) {
            if (escrows[i] == msg.sender) {
                return; // Already registered
            }
        }
        escrows.push(msg.sender);
    }

    function reconcileAllJobsBalance() external onlyOwner {
        require(!hasReconciled, "Already reconciled");
        uint256 escrowCount = allEscrows.length;
        for (uint256 i = 0; i < escrowCount; i++) {
            address escrowAddress = allEscrows[i];
            CspEscrow(escrowAddress).reconcileJobsBalance();
        }
        hasReconciled = true;
    }

    // Remove a node from the rewards list when rewards are claimed
    function removeNodeFromRewardsList(
        address nodeAddress
    ) external onlyCspEscrow {
        address escrowAddress = msg.sender;
        address[] storage escrows = nodeToEscrowsWithRewards[nodeAddress];
        for (uint256 i = 0; i < escrows.length; i++) {
            if (escrows[i] == escrowAddress) {
                // Remove by swapping with the last element and popping
                escrows[i] = escrows[escrows.length - 1];
                escrows.pop();
                break;
            }
        }
    }

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

    function _cacheNodesForJob(
        uint256 jobId,
        bytes32 nodesHash,
        address[] memory nodes
    ) private {
        if (jobIdNodesHashStored[jobId][nodesHash]) {
            return;
        }
        jobIdToNodesByNodesHash[jobId][nodesHash] = nodes;
        jobIdNodesHashStored[jobId][nodesHash] = true;
    }

    // Helper function to remove a job from the unvalidated list
    function _removeJobFromUnvalidatedList(uint256 jobId) private {
        if (!isJobUnvalidated[jobId]) {
            return; // Job is not in the list
        }

        // Find the job in the array and remove it by swapping with the last element
        for (uint256 i = 0; i < unvalidatedJobIds.length; i++) {
            if (unvalidatedJobIds[i] == jobId) {
                // Swap with the last element
                unvalidatedJobIds[i] = unvalidatedJobIds[
                    unvalidatedJobIds.length - 1
                ];
                unvalidatedJobIds.pop();
                isJobUnvalidated[jobId] = false;
                break;
            }
        }
    }

    // View function to get job details by job ID
    function getJobDetails(
        uint256 jobId
    ) public view returns (JobWithAllDetails memory) {
        address escrowAddress = jobIdToEscrow[jobId];
        address escrowOwner = escrowToOwner[escrowAddress];
        JobDetails memory jobDetails = CspEscrow(escrowAddress).getJobDetails(
            jobId
        );
        return
            JobWithAllDetails({
                id: jobDetails.id,
                projectHash: jobDetails.projectHash,
                requestTimestamp: jobDetails.requestTimestamp,
                startTimestamp: jobDetails.startTimestamp,
                lastNodesChangeTimestamp: jobDetails.lastNodesChangeTimestamp,
                jobType: jobDetails.jobType,
                pricePerEpoch: jobDetails.pricePerEpoch,
                lastExecutionEpoch: jobDetails.lastExecutionEpoch,
                numberOfNodesRequested: jobDetails.numberOfNodesRequested,
                balance: jobDetails.balance,
                lastAllocatedEpoch: jobDetails.lastAllocatedEpoch,
                activeNodes: jobDetails.activeNodes,
                escrowAddress: escrowAddress,
                escrowOwner: escrowOwner
            });
    }

    // Get all deployed escrow addresses
    function getAllEscrows() external view returns (address[] memory) {
        return allEscrows;
    }

    // Get total balance across all escrows
    function getTotalEscrowsBalance()
        external
        view
        returns (int256 totalBalance)
    {
        for (uint256 i = 0; i < allEscrows.length; i++) {
            totalBalance += CspEscrow(allEscrows[i]).getTotalJobsBalance();
        }
    }

    function getActiveJobsCount()
        external
        view
        returns (uint256 totalActiveJobs)
    {
        uint256 escrowCount = allEscrows.length;
        for (uint256 i = 0; i < escrowCount; i++) {
            totalActiveJobs += CspEscrow(allEscrows[i]).getActiveJobsCount();
        }
    }

    function getAllActiveJobs()
        external
        view
        returns (JobWithAllDetails[] memory)
    {
        uint256 escrowCount = allEscrows.length;
        uint256 totalActiveJobs = 0;
        for (uint256 i = 0; i < escrowCount; i++) {
            totalActiveJobs += CspEscrow(allEscrows[i]).getActiveJobsCount();
        }

        JobWithAllDetails[] memory jobs = new JobWithAllDetails[](
            totalActiveJobs
        );
        uint256 index = 0;
        for (uint256 i = 0; i < escrowCount; i++) {
            address escrowAddress = allEscrows[i];
            address escrowOwner = escrowToOwner[escrowAddress];
            JobDetails[] memory escrowJobs = CspEscrow(escrowAddress)
                .getActiveJobs();
            for (uint256 j = 0; j < escrowJobs.length; j++) {
                JobDetails memory job = escrowJobs[j];
                jobs[index] = JobWithAllDetails({
                    id: job.id,
                    projectHash: job.projectHash,
                    requestTimestamp: job.requestTimestamp,
                    startTimestamp: job.startTimestamp,
                    lastNodesChangeTimestamp: job.lastNodesChangeTimestamp,
                    jobType: job.jobType,
                    pricePerEpoch: job.pricePerEpoch,
                    lastExecutionEpoch: job.lastExecutionEpoch,
                    numberOfNodesRequested: job.numberOfNodesRequested,
                    balance: job.balance,
                    lastAllocatedEpoch: job.lastAllocatedEpoch,
                    activeNodes: job.activeNodes,
                    escrowAddress: escrowAddress,
                    escrowOwner: escrowOwner
                });
                index++;
            }
        }
        return jobs;
    }

    function getAllCspsWithOwner()
        external
        view
        returns (CspWithOwner[] memory)
    {
        uint256 escrowCount = allEscrows.length;
        CspWithOwner[] memory cspsWithOwner = new CspWithOwner[](escrowCount);
        for (uint256 i = 0; i < escrowCount; i++) {
            cspsWithOwner[i] = CspWithOwner({
                cspAddress: allEscrows[i],
                cspOwner: escrowToOwner[allEscrows[i]]
            });
        }
        return cspsWithOwner;
    }

    function getFirstClosableJobId() external view returns (uint256) {
        uint256 escrowCount = allEscrows.length;
        for (uint256 i = 0; i < escrowCount; i++) {
            uint256 jobId = CspEscrow(allEscrows[i]).getFirstClosableJobId();
            if (jobId != 0) {
                return jobId;
            }
        }
        return 0;
    }

    // Get escrows with rewards for a specific node
    function getEscrowsWithRewardsForNode(
        address nodeAddress
    ) external view returns (address[] memory) {
        return nodeToEscrowsWithRewards[nodeAddress];
    }

    // Get all job IDs that have node updates submitted but no consensus reached yet that a specific oracle has not submitted yet
    function getUnvalidatedJobIds(
        address oracle
    ) external view returns (uint256[] memory) {
        uint256 count = 0;
        // Count matching jobs
        for (uint256 i = 0; i < unvalidatedJobIds.length; i++) {
            NodesTransitionProposal[]
                storage proposals = nodesTransactionProposals[
                    unvalidatedJobIds[i]
                ][getCurrentEpoch()];
            bool found = false;
            for (uint256 j = 0; j < proposals.length; j++) {
                if (proposals[j].proposer == oracle) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                count++;
            }
        }
        // Create array with the correct size
        uint256[] memory _unvalidatedJobIds = new uint256[](count);
        // Populate array
        uint256 index = 0;
        for (uint256 i = 0; i < unvalidatedJobIds.length; i++) {
            NodesTransitionProposal[]
                storage proposals = nodesTransactionProposals[
                    unvalidatedJobIds[i]
                ][getCurrentEpoch()];
            bool found = false;
            for (uint256 j = 0; j < proposals.length; j++) {
                if (proposals[j].proposer == oracle) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                _unvalidatedJobIds[index] = unvalidatedJobIds[i];
                index++;
            }
        }
        return _unvalidatedJobIds;
    }

    function getIsLastEpochAllocated() external view returns (bool) {
        return lastAllocatedEpoch >= getCurrentEpoch() - 1;
    }

    // Get remaining cooldown time for a specific job after consensus
    function getRemainingCooldownTime(
        uint256 jobId
    ) external view returns (uint256) {
        uint256 lastConsensusTime = jobConsensusTimestamp[jobId];
        if (lastConsensusTime == 0) {
            return 0; // No consensus reached yet
        }
        uint256 timeSinceConsensus = block.timestamp - lastConsensusTime;
        if (timeSinceConsensus >= CONSENSUS_COOLDOWN_PERIOD) {
            return 0; // Cooldown period has expired
        }
        return CONSENSUS_COOLDOWN_PERIOD - timeSinceConsensus;
    }

    // Get PoAI rewards for a specific node
    function getNodePoAIRewards(
        address nodeAddress
    ) external view returns (uint256 usdcRewards, uint256 r1Rewards) {
        usdcRewards = 0;
        r1Rewards = 0;

        if (nodeAddress != address(0)) {
            // Get all escrows with rewards for this node
            address[] memory escrowsWithRewards = nodeToEscrowsWithRewards[
                nodeAddress
            ];

            // Sum up virtual wallet balances from all escrows
            for (uint256 i = 0; i < escrowsWithRewards.length; i++) {
                address escrowAddress = escrowsWithRewards[i];
                usdcRewards += CspEscrow(escrowAddress).virtualWalletBalance(
                    nodeAddress
                );
            }

            // Calculate R1 rewards from USDC rewards using Uniswap
            if (usdcRewards > 0) {
                address[] memory path = new address[](2);
                path[0] = usdcToken;
                path[1] = r1Token;

                try
                    IUniswapV2Router02(uniswapV2Router).getAmountsOut(
                        usdcRewards,
                        path
                    )
                returns (uint256[] memory amounts) {
                    r1Rewards = amounts[1];
                } catch {
                    r1Rewards = 0; // If swap calculation fails, set to 0
                }
            }
        }
    }

    modifier onlyCspEscrow() {
        require(escrowToOwner[msg.sender] != address(0), "Not a CSP Escrow");
        _;
    }
}
