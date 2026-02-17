// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AttestationRegistry is Initializable, OwnableUpgradeable {
    using MessageHashUtils for bytes32;

    bytes32 public constant REDMESH_ATTESTATION_DOMAIN =
        keccak256("RATIO1_REDMESH_ATTESTATION_V1");

    enum TestMode {
        SINGLE,
        CONTINUOUS
    }

    struct RedmeshAttestation {
        address node;
        uint16 nodeCount;
        uint8 vulnerabilityScore;
        uint8 testMode;
        bytes2 ipObfuscated;
        bytes10 cidObfuscated;
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
    event RedmeshAttestationStored(
        uint256 indexed index,
        address indexed node,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        address submitter
    );

    address public poaiManager;
    bool public nodeWhitelistEnforced;

    mapping(address => bool) public allowedNodes;
    RedmeshAttestation[] private redmeshAttestations;

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

    function getRedmeshAttestationCount() external view returns (uint256) {
        return redmeshAttestations.length;
    }

    function getRedmeshAttestation(
        uint256 index
    ) external view returns (RedmeshAttestation memory) {
        return redmeshAttestations[index];
    }

    function getRedmeshAttestationDigest(
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    REDMESH_ATTESTATION_DOMAIN,
                    testMode,
                    nodeCount,
                    vulnerabilityScore,
                    ipObfuscated,
                    cidObfuscated
                )
            );
    }

    function submitRedmeshAttestation(
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        bytes calldata nodeSignature
    ) external returns (uint256 index, address node) {
        if (testMode > uint8(TestMode.CONTINUOUS)) {
            revert InvalidTestMode();
        }
        if (vulnerabilityScore > 100) {
            revert InvalidVulnerabilityScore();
        }

        bytes32 digest = getRedmeshAttestationDigest(
            testMode,
            nodeCount,
            vulnerabilityScore,
            ipObfuscated,
            cidObfuscated
        );

        node = ECDSA.recover(digest.toEthSignedMessageHash(), nodeSignature);
        if (node == address(0)) {
            revert InvalidNodeSignature();
        }
        if (nodeWhitelistEnforced && !allowedNodes[node]) {
            revert NodeNotAllowed(node);
        }

        // TODO: when external job references are added back to RedMesh
        // attestations, verify `node` is active for that job in PoAIManager
        // before storing.

        RedmeshAttestation memory attestation = RedmeshAttestation({
            node: node,
            nodeCount: nodeCount,
            vulnerabilityScore: vulnerabilityScore,
            testMode: testMode,
            ipObfuscated: ipObfuscated,
            cidObfuscated: cidObfuscated
        });

        redmeshAttestations.push(attestation);
        index = redmeshAttestations.length - 1;

        emit RedmeshAttestationStored(
            index,
            node,
            testMode,
            nodeCount,
            vulnerabilityScore,
            ipObfuscated,
            cidObfuscated,
            msg.sender
        );
    }

    uint256[44] private __gap;
}
