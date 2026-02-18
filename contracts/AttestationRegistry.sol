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

    enum RedmeshTestMode {
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
        address tenant;
    }

    error InvalidAddress();
    error InvalidTestMode();
    error InvalidVulnerabilityScore();
    error AttestationIndexOverflow();

    event RedmeshAttestationStored(
        uint256 indexed index,
        address indexed node,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        address indexed submitter
    );

    address public poaiManager;
    RedmeshAttestation[] private redmeshAttestations;
    mapping(address => uint32[]) private tenantToRedmeshAttestationIndexes;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address newOwner,
        address poaiManager_
    ) public initializer {
        if (newOwner == address(0)) {
            revert InvalidAddress();
        }
        if (poaiManager_ == address(0)) {
            revert InvalidAddress();
        }
        __Ownable_init(newOwner);
        poaiManager = poaiManager_;
    }

    function getRedmeshAttestationCount() external view returns (uint256) {
        return redmeshAttestations.length;
    }

    function getTenantRedmeshAttestationIndexCount(
        address tenant
    ) external view returns (uint256) {
        return tenantToRedmeshAttestationIndexes[tenant].length;
    }

    function getRedmeshAttestation(
        uint256 index
    ) external view returns (RedmeshAttestation memory) {
        return redmeshAttestations[index];
    }

    function getRedmeshAttestations(
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (RedmeshAttestation[] memory) {
        uint256 total = redmeshAttestations.length;
        if (offset >= total || limit == 0) {
            return new RedmeshAttestation[](0);
        }

        uint256 count = total - offset;
        if (limit < count) {
            count = limit;
        }

        RedmeshAttestation[] memory page = new RedmeshAttestation[](count);
        if (latestFirst) {
            uint256 start = total - 1 - offset;
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshAttestations[start - i];
            }
        } else {
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshAttestations[offset + i];
            }
        }
        return page;
    }

    function getTenantRedmeshAttestationIndexes(
        address tenant,
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (uint256[] memory) {
        uint32[] storage tenantIndexes = tenantToRedmeshAttestationIndexes[
            tenant
        ];
        uint256 total = tenantIndexes.length;
        if (offset >= total || limit == 0) {
            return new uint256[](0);
        }

        uint256 count = total - offset;
        if (limit < count) {
            count = limit;
        }

        uint256[] memory page = new uint256[](count);
        if (latestFirst) {
            uint256 start = total - 1 - offset;
            for (uint256 i = 0; i < count; i++) {
                page[i] = uint256(tenantIndexes[start - i]);
            }
        } else {
            for (uint256 i = 0; i < count; i++) {
                page[i] = uint256(tenantIndexes[offset + i]);
            }
        }
        return page;
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
        if (testMode > uint8(RedmeshTestMode.CONTINUOUS)) {
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

        // TODO: when external job references are added back to RedMesh
        // attestations, verify `node` is active for that job in PoAIManager
        // before storing.

        RedmeshAttestation memory attestation = RedmeshAttestation({
            node: node,
            nodeCount: nodeCount,
            vulnerabilityScore: vulnerabilityScore,
            testMode: testMode,
            ipObfuscated: ipObfuscated,
            cidObfuscated: cidObfuscated,
            tenant: msg.sender
        });

        redmeshAttestations.push(attestation);
        index = redmeshAttestations.length - 1;
        if (index > type(uint32).max) {
            revert AttestationIndexOverflow();
        }
        tenantToRedmeshAttestationIndexes[msg.sender].push(uint32(index));

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
}
