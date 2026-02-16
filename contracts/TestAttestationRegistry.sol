// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TestAttestationRegistry is Initializable, OwnableUpgradeable {
    using MessageHashUtils for bytes32;

    bytes32 public constant ATTESTATION_DOMAIN =
        keccak256("RATIO1_TEST_ATTESTATION_V1");

    enum TestMode {
        SINGLE,
        CONTINUOUS
    }

    struct TestAttestation {
        address node;
        uint16 nodeCount;
        uint8 vulnerabilityScore;
        uint8 testMode;
        bytes2 ipObfuscated;
        bytes10 cidObfuscated;
        bytes32 contentHash;
    }

    error InvalidPoaiManager();
    error InvalidNodeAddress();
    error InvalidTestMode();
    error InvalidVulnerabilityScore();
    error InvalidNodeSignature();
    error NodeNotAllowed(address node);

    event PoaiManagerUpdated(address indexed oldPoaiManager, address indexed newPoaiManager);
    event NodeWhitelistEnforcementUpdated(bool enabled);
    event NodeAllowed(address indexed node, bool isAllowed);
    event TestAttestationStored(
        bytes32 indexed appId,
        uint256 indexed index,
        address indexed node,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        bytes32 contentHash,
        address submitter
    );

    address public poaiManager;
    bool public nodeWhitelistEnforced;

    mapping(address => bool) public allowedNodes;
    mapping(bytes32 => TestAttestation[]) private appIdToAttestations;

    function initialize(
        address newOwner,
        address poaiManager_,
        bool nodeWhitelistEnforced_
    ) public initializer {
        if (newOwner == address(0)) {
            revert InvalidNodeAddress();
        }
        if (poaiManager_ == address(0)) {
            revert InvalidPoaiManager();
        }
        __Ownable_init(newOwner);
        poaiManager = poaiManager_;
        nodeWhitelistEnforced = nodeWhitelistEnforced_;
    }

    function setPoaiManager(address poaiManager_) external onlyOwner {
        if (poaiManager_ == address(0)) {
            revert InvalidPoaiManager();
        }
        address oldPoaiManager = poaiManager;
        poaiManager = poaiManager_;
        emit PoaiManagerUpdated(oldPoaiManager, poaiManager_);
    }

    function setNodeWhitelistEnforced(bool enabled) external onlyOwner {
        nodeWhitelistEnforced = enabled;
        emit NodeWhitelistEnforcementUpdated(enabled);
    }

    function setNodeAllowed(address node, bool isAllowed) external onlyOwner {
        if (node == address(0)) {
            revert InvalidNodeAddress();
        }
        allowedNodes[node] = isAllowed;
        emit NodeAllowed(node, isAllowed);
    }

    function getAttestationCount(bytes32 appId) external view returns (uint256) {
        return appIdToAttestations[appId].length;
    }

    function getAttestation(
        bytes32 appId,
        uint256 index
    ) external view returns (TestAttestation memory) {
        return appIdToAttestations[appId][index];
    }

    function getAttestationDigest(
        bytes32 appId,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        bytes32 contentHash
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    ATTESTATION_DOMAIN,
                    appId,
                    testMode,
                    nodeCount,
                    vulnerabilityScore,
                    ipObfuscated,
                    cidObfuscated,
                    contentHash
                )
            );
    }

    function submitAttestation(
        bytes32 appId,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        bytes32 contentHash,
        bytes calldata nodeSignature
    ) external returns (uint256 index, address node) {
        if (testMode > uint8(TestMode.CONTINUOUS)) {
            revert InvalidTestMode();
        }
        if (vulnerabilityScore > 100) {
            revert InvalidVulnerabilityScore();
        }

        bytes32 digest = getAttestationDigest(
            appId,
            testMode,
            nodeCount,
            vulnerabilityScore,
            ipObfuscated,
            cidObfuscated,
            contentHash
        );

        node = ECDSA.recover(digest.toEthSignedMessageHash(), nodeSignature);
        if (node == address(0)) {
            revert InvalidNodeSignature();
        }
        if (nodeWhitelistEnforced && !allowedNodes[node]) {
            revert NodeNotAllowed(node);
        }

        // TODO: when external job references are added back to attestations,
        // verify `node` is active for that job in PoAIManager before storing.

        TestAttestation memory attestation = TestAttestation({
            node: node,
            nodeCount: nodeCount,
            vulnerabilityScore: vulnerabilityScore,
            testMode: testMode,
            ipObfuscated: ipObfuscated,
            cidObfuscated: cidObfuscated,
            contentHash: contentHash
        });

        appIdToAttestations[appId].push(attestation);
        index = appIdToAttestations[appId].length - 1;

        emit TestAttestationStored(
            appId,
            index,
            node,
            testMode,
            nodeCount,
            vulnerabilityScore,
            ipObfuscated,
            cidObfuscated,
            contentHash,
            msg.sender
        );
    }

    uint256[44] private __gap;
}
