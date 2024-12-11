// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./NAEURA.sol";

struct NodeAvailability {
    uint256 epoch;
    uint256 availability;
}

struct ComputeRewardsParams {
    uint256 licenseId;
    string nodeHash;
    NodeAvailability[] nodeAvailabilities;
}

struct ComputeRewardsResult {
    uint256 licenseId;
    uint256 rewardsAmount;
}

struct License {
    bool exists;
    uint256 licenseId;
    string nodeHash;
    uint256 lastClaimCycle;
    uint256 currentClaimAmount;
    uint256 licensePower;
}

struct LicenseInfo {
    uint256 licenseId;
    string nodeHash;
    uint256 lastClaimCycle;
    uint256 currentClaimAmount;
    uint256 remainingClaimAmount;
    uint256 currentClaimableCycles;
    uint256 licensePower;
}

contract MNDContract is ERC721, Pausable, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    NAEURA private _token;

    uint256 public startCycleTimestamp;
    address public signer;
    uint256 public cycleDuration;
    uint256 public cliffPeriod;
    uint256 public vestingTotalPeriod;
    uint256 public genesisUnlockPeriod;
    uint256 public totalLicenseSupply; // Total supply of master licenses. Takes into account the license power.

    // General constants
    uint8 private constant MAX_AVAILABILITY = 255;
    uint256 private constant PRICE_DECIMALS = 10 ** 18;
    uint256 constant MAX_TOKEN_SUPPLY = 1618033988 * PRICE_DECIMALS;
    uint256 constant MAX_PERCENT = 10000;

    // Master Node Deeds constants
    uint256 constant MAX_LICENSE_POWER = 200;
    uint256 constant MAX_MASTER_LICENSE_SUPPLY = 2680;
    uint256 constant TOTAL_EMISSION_PER_MASTER_LICENSE = (MAX_TOKEN_SUPPLY /
        MAX_PERCENT); // 0.01% of total supply
    uint256 constant VESTING_DURATION_CYCLES = 1825; // 5 years on mainnet

    // Genesis constants
    uint256 constant GENESIS_TOTAL_EMISSION =
        (MAX_TOKEN_SUPPLY * 3320) / MAX_PERCENT; // 33.2% of total supply
    uint256 constant GENESIS_MAX_UNLOCK_CYCLES = 365;

    string emptyNodeHash = "";

    // New struct for genesis address
    struct GenesisNode {
        string nodeHash;
        uint256 lastClaimTimestamp;
        uint256 currentClaimAmount;
    }

    // New mapping for genesis node
    mapping(address => GenesisNode) public genesisNode;

    // Main mapping: address => licenseId => license
    mapping(address => mapping(uint256 => License)) public licenses;

    // Additional mapping to keep track of user licenses
    mapping(address => uint256[]) public userLicenses;

    // New mapping to store all registered node hashes
    mapping(string => bool) public registeredNodeHashes;

    // Events
    event LicenseCreated(
        address indexed to,
        uint256 indexed tokenId,
        uint256 licensePower
    );
    event RegisterNode(
        address indexed to,
        uint256 indexed licenseId,
        string nodeHash
    );
    event NodeHashRemoved(
        address indexed owner,
        uint256 indexed licenseId,
        string oldNodeHash
    );
    event GenesisNodeRegistered(
        address indexed genesisAddress,
        string nodeHash
    );
    event GenesisRewardsClaimed(address indexed genesisAddress, uint256 amount);
    event SignerChanged(address newSigner);

    constructor(
        address tokenAddress,
        address signerAddress,
        uint256 newCycleDuration,
        uint256 cliffPeriodCycles // should be 120 on mainnet (4 months)
    ) ERC721("MNDLicense", "MND") {
        _token = NAEURA(tokenAddress);
        signer = signerAddress;

        // TODO - change with start date of the protocol
        startCycleTimestamp = 1710028800; // 2024-03-10 00:00:00 UTC
        cycleDuration = newCycleDuration;
        cliffPeriod = cliffPeriodCycles * cycleDuration;
        vestingTotalPeriod = VESTING_DURATION_CYCLES * cycleDuration;
        genesisUnlockPeriod = GENESIS_MAX_UNLOCK_CYCLES * cycleDuration;
        totalLicenseSupply = 0;
    }

    function addLicense(address to, uint256 licensePower) public onlyOwner {
        _requireNotPaused();
        require(
            licensePower > 0 && licensePower <= MAX_LICENSE_POWER,
            "Invalid license power"
        );
        require(
            totalLicenseSupply.add(licensePower) <= MAX_MASTER_LICENSE_SUPPLY,
            "Max supply reached"
        );

        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(to, newTokenId);
        totalLicenseSupply = totalLicenseSupply.add(licensePower);

        licenses[to][newTokenId] = License({
            exists: true,
            licenseId: newTokenId,
            nodeHash: emptyNodeHash,
            lastClaimCycle: getCurrentCycle(),
            currentClaimAmount: 0,
            licensePower: licensePower
        });

        userLicenses[to].push(newTokenId);

        emit LicenseCreated(to, newTokenId, licensePower);
    }

    function registerNode(uint256 licenseId, string memory nodeHash) public {
        _requireNotPaused();
        require(hasLicense(msg.sender, licenseId), "License does not exist");

        // Check if nodeHash already exists
        require(!registeredNodeHashes[nodeHash], "Node hash already exists");

        // Update the license
        License storage license = licenses[msg.sender][licenseId];
        license.nodeHash = nodeHash;
        license.lastClaimCycle = getCurrentCycle();

        // Add nodeHash to the list
        registeredNodeHashes[nodeHash] = true;

        emit RegisterNode(msg.sender, licenseId, nodeHash);
    }

    function removeNodeHash(uint256 licenseId) public {
        _requireNotPaused();
        require(hasLicense(msg.sender, licenseId), "License does not exist");
        License storage license = licenses[msg.sender][licenseId];

        string memory oldNodeHash = license.nodeHash;

        if (bytes(oldNodeHash).length > 0) {
            registeredNodeHashes[oldNodeHash] = false;
        }

        license.nodeHash = "";

        emit NodeHashRemoved(msg.sender, licenseId, oldNodeHash);
    }

    function claimRewards(
        ComputeRewardsParams[] memory paramsArray,
        bytes[] memory signatures
    ) public nonReentrant {
        _requireNotPaused();
        require(
            paramsArray.length == signatures.length,
            "Mismatched input arrays"
        );
        for (uint256 i = 0; i < paramsArray.length; i++) {
            require(
                verifySignature(
                    msg.sender,
                    paramsArray[i].licenseId,
                    paramsArray[i].nodeHash,
                    paramsArray[i].nodeAvailabilities,
                    signatures[i]
                ),
                "Invalid signature."
            );
        }

        ComputeRewardsResult[] memory rewardsArray = estimateRewards(
            msg.sender,
            paramsArray
        );

        uint256 totalRewards = 0;
        uint256 currentCycle = getCurrentCycle();
        for (uint256 i = 0; i < rewardsArray.length; i++) {
            if (!hasLicense(msg.sender, rewardsArray[i].licenseId)) {
                continue;
            }

            License storage license = licenses[msg.sender][
                rewardsArray[i].licenseId
            ];

            license.lastClaimCycle = currentCycle;
            license.currentClaimAmount = license.currentClaimAmount.add(
                rewardsArray[i].rewardsAmount
            );
            totalRewards = totalRewards.add(rewardsArray[i].rewardsAmount);
        }

        if (totalRewards > 0) {
            _token.mint(msg.sender, totalRewards);
        }
    }

    function estimateRewards(
        address addr,
        ComputeRewardsParams[] memory paramsArray
    ) public view returns (ComputeRewardsResult[] memory) {
        ComputeRewardsResult[] memory results = new ComputeRewardsResult[](
            paramsArray.length
        );

        uint256 currentCycle = getCurrentCycle();
        uint256 startCycle = getStartCycle();
        for (uint256 i = 0; i < paramsArray.length; i++) {
            ComputeRewardsParams memory params = paramsArray[i];
            uint256 value = 0;

            if (!hasLicense(addr, params.licenseId)) {
                continue;
            }
            License storage license = licenses[addr][params.licenseId];

            require(
                keccak256(abi.encodePacked(license.nodeHash)) ==
                    keccak256(abi.encodePacked(params.nodeHash)),
                "Invalid node hash."
            );

            uint256 maxClaimableAmount = TOTAL_EMISSION_PER_MASTER_LICENSE.mul(
                license.licensePower
            );

            if (maxClaimableAmount == license.currentClaimAmount) {
                continue;
            }

            if (
                license.lastClaimCycle < currentCycle &&
                license.currentClaimAmount < maxClaimableAmount
            ) {
                uint256 cyclesToClaim = currentCycle.sub(
                    license.lastClaimCycle
                );
                require(
                    params.nodeAvailabilities.length == cyclesToClaim,
                    "Incorrect number of availabilites."
                );

                uint256 timeElapsed = (currentCycle.sub(startCycle)).mul(
                    cycleDuration
                );

                if (timeElapsed > cliffPeriod) {
                    uint256 vestingPeriod = timeElapsed.sub(cliffPeriod);
                    if (vestingPeriod > vestingTotalPeriod) {
                        vestingPeriod = vestingTotalPeriod;
                    }

                    uint256 maxRewardsForPeriod = maxClaimableAmount
                        .mul(vestingPeriod)
                        .div(vestingTotalPeriod);

                    uint256 totalAvailability = 0;
                    for (
                        uint256 j = 0;
                        j < params.nodeAvailabilities.length;
                        j++
                    ) {
                        totalAvailability = totalAvailability.add(
                            params.nodeAvailabilities[j].availability
                        );
                    }

                    value = maxRewardsForPeriod
                        .mul(totalAvailability)
                        .div(MAX_AVAILABILITY)
                        .div(cyclesToClaim);

                    uint256 maxRemainingClaimableAmount = maxClaimableAmount
                        .sub(license.currentClaimAmount);
                    if (value > maxRemainingClaimableAmount) {
                        value = maxRemainingClaimableAmount;
                    }
                }
            }

            results[i] = ComputeRewardsResult({
                licenseId: params.licenseId,
                rewardsAmount: value
            });
        }

        return results;
    }

    function registerGenesisNode(string memory nodeHash) public onlyOwner {
        genesisNode[msg.sender] = GenesisNode({
            nodeHash: nodeHash,
            lastClaimTimestamp: block.timestamp,
            currentClaimAmount: 0
        });

        // Add nodeHash to the list
        registeredNodeHashes[nodeHash] = true;

        emit GenesisNodeRegistered(msg.sender, nodeHash);
    }

    function claimGenesisRewards() public onlyOwner {
        require(
            bytes(genesisNode[msg.sender].nodeHash).length > 0,
            "Genesis node hash is empty"
        );
        require(
            block.timestamp > genesisNode[msg.sender].lastClaimTimestamp,
            "No rewards to claim yet"
        );
        require(
            genesisNode[msg.sender].currentClaimAmount < GENESIS_TOTAL_EMISSION,
            "All rewards have been claimed"
        );

        uint256 elapsedTime = block.timestamp.sub(
            genesisNode[msg.sender].lastClaimTimestamp
        );

        uint256 rewardsAmount = GENESIS_TOTAL_EMISSION.mul(elapsedTime).div(
            genesisUnlockPeriod
        );

        if (
            rewardsAmount.add(genesisNode[msg.sender].currentClaimAmount) >
            GENESIS_TOTAL_EMISSION
        ) {
            rewardsAmount = GENESIS_TOTAL_EMISSION.sub(
                genesisNode[msg.sender].currentClaimAmount
            );
        }

        if (rewardsAmount > 0) {
            genesisNode[msg.sender].lastClaimTimestamp = block.timestamp;
            genesisNode[msg.sender].currentClaimAmount = genesisNode[msg.sender]
                .currentClaimAmount
                .add(rewardsAmount);
            _token.mint(msg.sender, rewardsAmount);
            emit GenesisRewardsClaimed(msg.sender, rewardsAmount);
        }
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function getCurrentCycle() public view returns (uint256) {
        return _calculateCycle(block.timestamp);
    }

    function getStartCycle() public view returns (uint256) {
        return _calculateCycle(startCycleTimestamp);
    }

    function _calculateCycle(uint256 timestamp) private view returns (uint256) {
        require(
            timestamp >= startCycleTimestamp,
            "Timestamp is before the start cycle."
        );

        uint256 timeDiff = timestamp.sub(startCycleTimestamp);
        return timeDiff.div(cycleDuration);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override whenNotPaused {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    ///// View functions
    function hasLicense(
        address addr,
        uint256 licenseId
    ) public view returns (bool) {
        return licenses[addr][licenseId].exists;
    }

    function getLicenses(
        address addr
    ) public view returns (LicenseInfo[] memory) {
        uint256[] memory _userLicenses = userLicenses[addr];
        LicenseInfo[] memory licenseInfos = new LicenseInfo[](
            _userLicenses.length
        );

        uint256 currentCycle = getCurrentCycle();

        for (uint256 i = 0; i < _userLicenses.length; i++) {
            uint256 licenseId = _userLicenses[i];
            License storage license = licenses[addr][licenseId];

            uint256 cyclesToClaim = 0;
            if (
                license.lastClaimCycle >= currentCycle ||
                license.currentClaimAmount >= TOTAL_EMISSION_PER_MASTER_LICENSE
            ) {
                cyclesToClaim = 0;
            } else {
                cyclesToClaim = currentCycle - license.lastClaimCycle;
            }

            licenseInfos[i] = LicenseInfo({
                licenseId: license.licenseId,
                nodeHash: license.nodeHash,
                lastClaimCycle: license.lastClaimCycle,
                currentClaimAmount: license.currentClaimAmount,
                remainingClaimAmount: TOTAL_EMISSION_PER_MASTER_LICENSE -
                    license.currentClaimAmount,
                currentClaimableCycles: cyclesToClaim,
                licensePower: license.licensePower
            });
        }

        return licenseInfos;
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifySignature(
        address _to,
        uint256 _licenseId,
        string memory _nodeHash,
        NodeAvailability[] memory _nodeAvailabilities,
        bytes memory signature
    ) internal view returns (bool) {
        bytes32 messageHash = getMessageHash(
            _to,
            _licenseId,
            _nodeHash,
            _nodeAvailabilities
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        return ethSignedMessageHash.recover(signature) == signer;
    }

    function getMessageHash(
        address _to,
        uint256 _licenseId,
        string memory _nodeHash,
        NodeAvailability[] memory _nodeAvailabilities
    ) public pure returns (bytes32) {
        bytes memory encoded;
        for (uint i = 0; i < _nodeAvailabilities.length; i++) {
            encoded = abi.encodePacked(
                encoded,
                _nodeAvailabilities[i].epoch,
                _nodeAvailabilities[i].availability
            );
        }
        return keccak256(abi.encodePacked(_to, _licenseId, _nodeHash, encoded));
    }

    function changeSigner(address newSigner) public onlyOwner {
        signer = newSigner;
        emit SignerChanged(newSigner);
    }
}
