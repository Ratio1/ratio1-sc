// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./NAEURA.sol";

struct ComputeRewardsParams {
    uint256 licenseId;
    address nodeAddress;
    uint256[] epochs;
    uint8[] availabilies;
}

struct ComputeRewardsResult {
    uint256 licenseId;
    uint256 rewardsAmount;
}

struct License {
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    uint256 licensePower;
    //TODO add lastClaimOracle
}

struct GenesisNode {
    string nodeAddress;
    uint256 lastClaimTimestamp; //TODO for GND use timestamp instead of epoch?
    uint256 totalClaimedAmount;
}

struct LicenseInfo {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 remainingAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
    uint256 assignTimestamp;
    uint256 licensePower;
}

//TODO add ERC721URIStorage?
contract MNDContract is ERC721Enumerable, Pausable, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using Counters for Counters.Counter;

    //..######...#######..##....##..######..########....###....##....##.########..######.
    //.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
    //.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
    //.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
    //.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
    //.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
    //..######...#######..##....##..######.....##....##.....##.##....##....##.....######.

    // TODO - change with start date of the protocol
    uint256 constant startEpochTimestamp = 1710028800; // 2024-03-10 00:00:00 UTC
    uint256 constant epochDuration = 24 hours;

    uint256 constant MAX_PERCENTAGE = 100_00;
    uint8 constant MAX_AVAILABILITY = 255;

    uint256 constant PRICE_DECIMALS = 10 ** 18;
    uint256 constant MAX_TOKEN_SUPPLY = 1618033988 * PRICE_DECIMALS;

    uint256 constant TOKENS_PER_LICENSE_POWER = (MAX_TOKEN_SUPPLY /
        MAX_PERCENTAGE); // 0.01% of total supply
    uint256 constant MAX_POWER_PER_LICENSE = 200;
    uint256 constant MAX_MND_TOTAL_POWER = 26_10;
    uint256 constant MAX_MND_SUPPLY = 500; //TODO how many max MNDs can be minted?
    uint256 constant CLIFF_EPOCHS = 30 * 4;
    uint256 constant VESTING_DURATION_YEARS = 5;
    uint256 constant VESTING_DURATION_EPOCHS = VESTING_DURATION_YEARS * 365;
    uint256 constant VESTING_DURATION = VESTING_DURATION_EPOCHS * epochDuration;

    uint256 constant GENESIS_TOTAL_EMISSION =
        (MAX_TOKEN_SUPPLY * 33_20) / MAX_PERCENTAGE; // 33.2% of total supply
    uint256 constant GENESIS_UNLOCK_EPOCHS = 365;
    uint256 constant GENESIS_UNLOCK_DURATION =
        GENESIS_UNLOCK_EPOCHS * epochDuration;
    uint256 constant GENESIS_TOKEN_ID = 0;

    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    Counters.Counter private _supply;

    NAEURA private _naeuraToken;

    uint256 public totalLicensesPower;
    address[] public signers;
    mapping(address => bool) isSigner;
    mapping(uint256 => License) public licenses;

    //TODO address is needed?
    mapping(address => GenesisNode) public genesisNode;
    mapping(address => bool) public registeredNodeAddresses;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event LicenseCreated(
        address indexed to,
        uint256 indexed tokenId,
        uint256 licensePower
    );
    event LinkNode(
        address indexed to,
        uint256 indexed licenseId,
        address nodeAddress
    );
    event UnlinkNode(
        address indexed owner,
        uint256 indexed licenseId,
        address oldNodeAddress
    );
    event SignerAdded(address newSigner);
    event SignerRemoved(address removedSigner);

    constructor(
        address tokenAddress,
        address signerAddress
    ) ERC721("MNDLicense", "MND") {
        _naeuraToken = NAEURA(tokenAddress);
        addSigner(signerAddress);

        // Mint the first Genesis Node Deed
        _safeMint(msg.sender, GENESIS_TOKEN_ID); //TODO verify implications of minting id 0
        licenses[GENESIS_TOKEN_ID] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            assignTimestamp: 0,
            licensePower: 0
        });
    }

    function addLicense(
        address to,
        uint256 newLicensePower
    ) public onlyOwner whenNotPaused {
        require(
            newLicensePower > 0 && newLicensePower <= MAX_POWER_PER_LICENSE,
            "Invalid license power"
        );
        require(
            totalLicensesPower + newLicensePower <= MAX_MND_TOTAL_POWER,
            "Max supply reached"
        );
        require(_supply.current() < MAX_MND_SUPPLY, "Max supply reached");
        require(balanceOf(to) == 0, "User already has a license");

        uint256 tokenId = safeMint(to);
        totalLicensesPower += newLicensePower;
        licenses[tokenId] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            assignTimestamp: 0,
            licensePower: newLicensePower
        });

        emit LicenseCreated(to, tokenId, newLicensePower);
    }

    function linkNode(
        uint256 licenseId,
        address newNodeAddress
    ) public whenNotPaused {
        require(
            ownerOf(licenseId) == msg.sender,
            "Not the owner of the license"
        );
        require(newNodeAddress != address(0), "Invalid node address");
        require(
            !registeredNodeAddresses[newNodeAddress],
            "Node address already registered"
        );

        // TODO: check if nodeAddress also in ND

        // Update the license
        License storage license = licenses[licenseId];
        require(
            license.assignTimestamp + 24 hours < block.timestamp,
            "Cannot reassign within 24 hours"
        );

        _removeNodeAddress(license, licenseId);
        license.nodeAddress = newNodeAddress;
        license.lastClaimEpoch = getCurrentEpoch();
        license.assignTimestamp = block.timestamp;
        registeredNodeAddresses[newNodeAddress] = true;

        emit LinkNode(msg.sender, licenseId, newNodeAddress);
    }

    function unlinkNode(uint256 licenseId) public whenNotPaused {
        require(
            ownerOf(licenseId) == msg.sender,
            "Not the owner of the license"
        );
        License storage license = licenses[licenseId];
        _removeNodeAddress(license, licenseId);
    }

    function _removeNodeAddress(
        License storage license,
        uint256 licenseId
    ) private {
        if (license.nodeAddress == address(0)) {
            return;
        }

        // TODO: force claim rewards before removing nodeAddress
        address oldNodeAddress = license.nodeAddress;
        registeredNodeAddresses[license.nodeAddress] = false;
        license.nodeAddress = address(0);

        emit UnlinkNode(msg.sender, licenseId, oldNodeAddress);
    }

    function claimRewards(
        ComputeRewardsParams memory computeParam,
        bytes memory signature
    ) public nonReentrant whenNotPaused {
        require(
            ownerOf(computeParam.licenseId) == msg.sender,
            "User does not have the license"
        );
        require(
            verifyRewardsSignature(computeParam, signature),
            "Invalid signature"
        );

        License storage license = licenses[computeParam.licenseId];
        uint256 rewardsAmount = calculateLicenseRewards(license, computeParam);

        license.lastClaimEpoch = getCurrentEpoch();
        license.totalClaimedAmount += rewardsAmount;

        if (rewardsAmount > 0) {
            _naeuraToken.mint(msg.sender, rewardsAmount);
        }
    }

    function calculateRewards(
        ComputeRewardsParams memory paramsArray
    ) public view returns (ComputeRewardsResult memory) {
        License storage license = licenses[paramsArray.licenseId];
        uint256 rewardsAmount = calculateLicenseRewards(license, paramsArray);

        return
            ComputeRewardsResult({
                licenseId: paramsArray.licenseId,
                rewardsAmount: rewardsAmount
            });
    }

    function calculateLicenseRewards(
        License memory license,
        ComputeRewardsParams memory computeParam
    ) internal view returns (uint256) {
        /*
        uint256 currentEpoch = getCurrentEpoch();
        uint256 startEpoch = getStartEpoch(); //TODO why ND doesn't have this?
        uint256 licenseRewards = 0;

        if (currentEpoch < CLIFF_EPOCHS) {
            return 0;
        }

        require( // TODO: remove this check?
            license.nodeAddress == computeParam.nodeAddress,
            "Invalid node address."
        );

        uint256 licenseMaxClaimableAmount = TOKENS_PER_LICENSE_POWER *
            license.licensePower;
        if (licenseMaxClaimableAmount == license.totalClaimedAmount) {
            return 0;
        }

        uint256 firstEpochToClaim = license.lastClaimEpoch < CLIFF_EPOCHS
            ? CLIFF_EPOCHS
            : license.lastClaimEpoch;
        uint256 lastEpochToClaim = currentEpoch < VESTING_DURATION_EPOCHS
            ? currentEpoch
            : VESTING_DURATION_EPOCHS;
        uint256 epochsToClaim = currentEpoch - license.lastClaimEpoch;
        if (epochsToClaim == 0) {
            return 0;
        }

        require(
            computeParam.epochs.length == epochsToClaim &&
                computeParam.availabilies.length == epochsToClaim,
            "Incorrect number of params."
        );

        uint256 timeElapsed = (currentEpoch - startEpoch) * epochDuration;

        //uint256 epochsWithRewards =
        uint256 vestingPeriod = timeElapsed.sub(cliffDuration);
        if (vestingPeriod > VESTING_DURATION) {
            vestingPeriod = VESTING_DURATION;
        }

        uint256 maxRewardsForPeriod = licenseMaxClaimableAmount
            .mul(vestingPeriod)
            .div(VESTING_DURATION);

        uint256 totalAvailability = 0;
        for (uint256 j = 0; j < computeParam.nodeAvailabilities.length; j++) {
            totalAvailability = totalAvailability.add(
                computeParam.nodeAvailabilities[j].availability
            );
        }

        value = maxRewardsForPeriod
            .mul(totalAvailability)
            .div(MAX_AVAILABILITY)
            .div(cyclesToClaim);

        uint256 maxRemainingClaimableAmount = licenseMaxClaimableAmount.sub(
            license.currentClaimAmount
        );
        if (value > maxRemainingClaimableAmount) {
            value = maxRemainingClaimableAmount;
        }

        return licenseRewards;
        */
        return 0;
    }

    function claimGenesisRewards() public onlyOwner {
        /*
        require(
            bytes(genesisNode[msg.sender].nodeAddress).length > 0,
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
            GENESIS_UNLOCK_DURATION
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
            _naeuraToken.mint(msg.sender, rewardsAmount);
        }
        */
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function safeMint(address to) private returns (uint256) {
        _supply.increment();
        uint256 newTokenId = _supply.current();
        require(newTokenId <= MAX_MND_SUPPLY, "Maximum token supply reached.");

        _safeMint(to, newTokenId);
        return newTokenId;
    }

    function getCurrentEpoch() public view returns (uint256) {
        return _calculateEpoch(block.timestamp);
    }

    function _calculateEpoch(uint256 timestamp) private pure returns (uint256) {
        require(
            timestamp >= startEpochTimestamp,
            "Timestamp is before the start epoch."
        );

        return (timestamp - startEpochTimestamp) / epochDuration;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override whenNotPaused {
        require(
            from == address(0) || to == address(0),
            "Soulbound: Non-transferable token"
        );
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    //.##.....##.####.########.##......##....########.##.....##.##....##..######..########.####..#######..##....##..######.
    //.##.....##..##..##.......##..##..##....##.......##.....##.###...##.##....##....##.....##..##.....##.###...##.##....##
    //.##.....##..##..##.......##..##..##....##.......##.....##.####..##.##..........##.....##..##.....##.####..##.##......
    //.##.....##..##..######...##..##..##....######...##.....##.##.##.##.##..........##.....##..##.....##.##.##.##..######.
    //..##...##...##..##.......##..##..##....##.......##.....##.##..####.##..........##.....##..##.....##.##..####.......##
    //...##.##....##..##.......##..##..##....##.......##.....##.##...###.##....##....##.....##..##.....##.##...###.##....##
    //....###....####.########..###..###.....##........#######..##....##..######.....##....####..#######..##....##..######.

    function getUserLicense(
        address addr
    ) public view returns (LicenseInfo memory) {
        if (balanceOf(addr) == 0) {
            return
                LicenseInfo({
                    licenseId: 0,
                    nodeAddress: address(0),
                    totalClaimedAmount: 0,
                    remainingAmount: 0,
                    lastClaimEpoch: 0,
                    claimableEpochs: 0,
                    assignTimestamp: 0,
                    licensePower: 0
                });
        }
        uint256 licenseId = tokenOfOwnerByIndex(addr, 0);
        License memory license = licenses[licenseId];

        uint256 currentEpoch = getCurrentEpoch();

        uint256 epochsToClaim = 0;
        if (
            license.lastClaimEpoch >= currentEpoch ||
            license.totalClaimedAmount >= TOKENS_PER_LICENSE_POWER
        ) {
            epochsToClaim = 0;
        } else {
            epochsToClaim = currentEpoch - license.lastClaimEpoch;
        }

        //TODO
        return
            LicenseInfo({
                licenseId: 0,
                nodeAddress: address(0),
                totalClaimedAmount: 0,
                remainingAmount: 0,
                lastClaimEpoch: 0,
                claimableEpochs: 0,
                assignTimestamp: 0,
                licensePower: 0
            });
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifySignature(
        bytes32 ethSignedMessageHash,
        bytes memory signature
    ) internal view returns (bool) {
        return isSigner[ethSignedMessageHash.recover(signature)];
    }

    function verifyRewardsSignature(
        ComputeRewardsParams memory computeParam,
        bytes memory signature //TODO allow multiple signers
    ) public view returns (bool) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                computeParam.nodeAddress,
                computeParam.epochs,
                computeParam.availabilies
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return verifySignature(ethSignedMessageHash, signature);
    }

    function addSigner(address newSigner) public onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        require(!isSigner[newSigner], "Signer already exists");
        isSigner[newSigner] = true;
        signers.push(newSigner);
        emit SignerAdded(newSigner);
    }

    function removeSigner(address signerToRemove) public onlyOwner {
        require(isSigner[signerToRemove], "Signer does not exist");
        isSigner[signerToRemove] = false;
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == signerToRemove) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        emit SignerRemoved(signerToRemove);
    }
}
