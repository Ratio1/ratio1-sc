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

    struct RedmeshTestAttestation {
        address node;
        bytes10 cidObfuscated;
        bytes2 ipObfuscated;
        bytes8 executionId;
        address tenant;
        uint16 nodeCount;
        uint8 testMode;
        uint8 vulnerabilityScore;
    }

    struct RedmeshJobStartAttestation {
        address node;
        bytes2 ipObfuscated;
        bytes8 executionId;
        uint16 nodeCount;
        uint8 testMode;
        address tenant;
        bytes32 nodeHashes;
    }

    error InvalidAddress();
    error InvalidTestMode();
    error InvalidVulnerabilityScore();
    error AttestationIndexOverflow();

    event RedmeshTestAttestationStored(
        uint256 index,
        address indexed node,
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes8 indexed executionId,
        bytes2 ipObfuscated,
        bytes10 cidObfuscated,
        address indexed submitter
    );
    event RedmeshJobStartAttestationStored(
        uint256 index,
        address indexed node,
        uint8 testMode,
        uint16 nodeCount,
        bytes8 indexed executionId,
        bytes32 nodeHashes,
        bytes2 ipObfuscated,
        address indexed submitter
    );

    address public poaiManager;
    RedmeshTestAttestation[] private redmeshTestAttestations;
    mapping(address => uint32[]) private tenantToRedmeshTestAttestationIndexes;
    RedmeshJobStartAttestation[] private redmeshJobStartAttestations;
    mapping(address => uint32[])
        private tenantToRedmeshJobStartAttestationIndexes;

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

    function getRedmeshTestAttestationCount() external view returns (uint256) {
        return redmeshTestAttestations.length;
    }

    function getTenantRedmeshTestAttestationIndexCount(
        address tenant
    ) external view returns (uint256) {
        return tenantToRedmeshTestAttestationIndexes[tenant].length;
    }

    function getRedmeshTestAttestation(
        uint256 index
    ) external view returns (RedmeshTestAttestation memory) {
        return redmeshTestAttestations[index];
    }

    function getRedmeshTestAttestations(
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (RedmeshTestAttestation[] memory) {
        uint256 total = redmeshTestAttestations.length;
        if (offset >= total || limit == 0) {
            return new RedmeshTestAttestation[](0);
        }

        uint256 count = total - offset;
        if (limit < count) {
            count = limit;
        }

        RedmeshTestAttestation[] memory page = new RedmeshTestAttestation[](
            count
        );
        if (latestFirst) {
            uint256 start = total - 1 - offset;
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshTestAttestations[start - i];
            }
        } else {
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshTestAttestations[offset + i];
            }
        }
        return page;
    }

    function getTenantRedmeshTestAttestationIndexes(
        address tenant,
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (uint256[] memory) {
        uint32[] storage tenantIndexes = tenantToRedmeshTestAttestationIndexes[
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

    function getRedmeshJobStartAttestationCount()
        external
        view
        returns (uint256)
    {
        return redmeshJobStartAttestations.length;
    }

    function getTenantRedmeshJobStartAttestationIndexCount(
        address tenant
    ) external view returns (uint256) {
        return tenantToRedmeshJobStartAttestationIndexes[tenant].length;
    }

    function getRedmeshJobStartAttestation(
        uint256 index
    ) external view returns (RedmeshJobStartAttestation memory) {
        return redmeshJobStartAttestations[index];
    }

    function getRedmeshJobStartAttestations(
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (RedmeshJobStartAttestation[] memory) {
        uint256 total = redmeshJobStartAttestations.length;
        if (offset >= total || limit == 0) {
            return new RedmeshJobStartAttestation[](0);
        }

        uint256 count = total - offset;
        if (limit < count) {
            count = limit;
        }

        RedmeshJobStartAttestation[]
            memory page = new RedmeshJobStartAttestation[](count);
        if (latestFirst) {
            uint256 start = total - 1 - offset;
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshJobStartAttestations[start - i];
            }
        } else {
            for (uint256 i = 0; i < count; i++) {
                page[i] = redmeshJobStartAttestations[offset + i];
            }
        }
        return page;
    }

    function getTenantRedmeshJobStartAttestationIndexes(
        address tenant,
        uint256 offset,
        uint256 limit,
        bool latestFirst
    ) external view returns (uint256[] memory) {
        uint32[]
            storage tenantIndexes = tenantToRedmeshJobStartAttestationIndexes[
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

    function getRedmeshTestAttestationDigest(
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes8 executionId,
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
                    executionId,
                    ipObfuscated,
                    cidObfuscated
                )
            );
    }

    function getRedmeshJobStartAttestationDigest(
        uint8 testMode,
        uint16 nodeCount,
        bytes8 executionId,
        bytes32 nodeHashes,
        bytes2 ipObfuscated
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    REDMESH_ATTESTATION_DOMAIN,
                    testMode,
                    nodeCount,
                    executionId,
                    nodeHashes,
                    ipObfuscated
                )
            );
    }

    function submitRedmeshTestAttestation(
        uint8 testMode,
        uint16 nodeCount,
        uint8 vulnerabilityScore,
        bytes8 executionId,
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
        address submitter = msg.sender;

        {
            bytes32 digest = getRedmeshTestAttestationDigest(
                testMode,
                nodeCount,
                vulnerabilityScore,
                executionId,
                ipObfuscated,
                cidObfuscated
            );
            node = ECDSA.recover(
                digest.toEthSignedMessageHash(),
                nodeSignature
            );
        }

        // TODO: when external job references are added back to RedMesh
        // attestations, verify `node` is active for that job in PoAIManager
        // before storing.

        redmeshTestAttestations.push(
            RedmeshTestAttestation({
                node: node,
                cidObfuscated: cidObfuscated,
                ipObfuscated: ipObfuscated,
                executionId: executionId,
                tenant: submitter,
                nodeCount: nodeCount,
                testMode: testMode,
                vulnerabilityScore: vulnerabilityScore
            })
        );
        index = redmeshTestAttestations.length - 1;
        if (index > type(uint32).max) {
            revert AttestationIndexOverflow();
        }
        tenantToRedmeshTestAttestationIndexes[submitter].push(uint32(index));
        RedmeshTestAttestation storage stored = redmeshTestAttestations[index];

        emit RedmeshTestAttestationStored(
            index,
            node,
            stored.testMode,
            stored.nodeCount,
            stored.vulnerabilityScore,
            stored.executionId,
            stored.ipObfuscated,
            stored.cidObfuscated,
            submitter
        );
    }

    function submitRedmeshJobStartAttestation(
        uint8 testMode,
        uint16 nodeCount,
        bytes8 executionId,
        bytes32 nodeHashes,
        bytes2 ipObfuscated,
        bytes calldata nodeSignature
    ) external returns (uint256 index, address node) {
        if (testMode > uint8(RedmeshTestMode.CONTINUOUS)) {
            revert InvalidTestMode();
        }
        address submitter = msg.sender;

        {
            bytes32 digest = getRedmeshJobStartAttestationDigest(
                testMode,
                nodeCount,
                executionId,
                nodeHashes,
                ipObfuscated
            );
            node = ECDSA.recover(
                digest.toEthSignedMessageHash(),
                nodeSignature
            );
        }

        // TODO: when external job references are added back to RedMesh
        // attestations, verify `node` is active for that job in PoAIManager
        // before storing.

        redmeshJobStartAttestations.push(
            RedmeshJobStartAttestation({
                node: node,
                ipObfuscated: ipObfuscated,
                executionId: executionId,
                nodeCount: nodeCount,
                testMode: testMode,
                tenant: submitter,
                nodeHashes: nodeHashes
            })
        );
        index = redmeshJobStartAttestations.length - 1;
        if (index > type(uint32).max) {
            revert AttestationIndexOverflow();
        }
        tenantToRedmeshJobStartAttestationIndexes[submitter].push(
            uint32(index)
        );
        RedmeshJobStartAttestation storage stored = redmeshJobStartAttestations[
            index
        ];

        emit RedmeshJobStartAttestationStored(
            index,
            node,
            stored.testMode,
            stored.nodeCount,
            stored.executionId,
            stored.nodeHashes,
            stored.ipObfuscated,
            submitter
        );
    }
}
