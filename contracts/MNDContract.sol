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

interface IND {
    function registeredNodeAddresses(address node) external view returns (bool);
}

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
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
}

struct LicenseInfo {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 remainingAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
    uint256 assignTimestamp;
    address lastClaimOracle;
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

    uint256 constant MAX_TOKENS_ASSIGNED_PER_LICENSE =
        (MAX_TOKEN_SUPPLY * 2_00) / MAX_PERCENTAGE;
    uint256 constant MAX_MND_TOTAL_ASSIGNED_TOKENS =
        (MAX_TOKEN_SUPPLY * 26_10) / MAX_PERCENTAGE; // 26.1% of total supply
    uint256 constant MAX_MND_SUPPLY = 500;
    uint256 constant CLIFF_EPOCHS = 30 * 4;
    uint256 constant VESTING_DURATION_YEARS = 5;
    uint256 constant VESTING_DURATION_EPOCHS = VESTING_DURATION_YEARS * 365;

    uint256 constant GENESIS_TOTAL_EMISSION =
        (MAX_TOKEN_SUPPLY * 33_20) / MAX_PERCENTAGE; // 33.2% of total supply
    uint256 constant GENESIS_UNLOCK_EPOCHS = 365;
    uint256 constant GENESIS_TOKEN_ID = 0;

    uint256 constant LP_WALLET_PERCENTAGE = 26_70;
    uint256 constant EXPENSES_WALLET_PERCENTAGE = 13_80;
    uint256 constant MARKETING_WALLET_PERCENTAGE = 7_50;
    uint256 constant GRANTS_WALLET_PERCENTAGE = 34_60;
    uint256 constant CSR_WALLET_PERCENTAGE = 17_30;

    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    Counters.Counter private _supply;

    NAEURA private _naeuraToken;
    IND _ndContract;
    address lpWallet;
    address expensesWallet;
    address marketingWallet;
    address grantsWallet;
    address csrWallet;

    uint256 public totalLicensesAssignedTokensAmount;
    address[] public signers;
    uint8 public minimumRequiredSignatures;
    mapping(address => bool) isSigner;
    mapping(uint256 => License) public licenses;
    mapping(address => bool) public registeredNodeAddresses;
    mapping(address => uint256) public signerSignaturesCount;
    mapping(address => uint256) public signerAdditionTimestamp;

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
        uint256 totalAssignedAmount
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

    constructor(address tokenAddress) ERC721("MNDLicense", "MND") {
        _naeuraToken = NAEURA(tokenAddress);
        minimumRequiredSignatures = 1;

        // Mint the first Genesis Node Deed
        _safeMint(msg.sender, GENESIS_TOKEN_ID);
        licenses[GENESIS_TOKEN_ID] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            assignTimestamp: 0,
            totalAssignedAmount: GENESIS_TOTAL_EMISSION,
            lastClaimOracle: address(0)
        });
    }

    function addLicense(
        address to,
        uint256 newTotalAssignedAmount
    ) public onlyOwner whenNotPaused {
        require(
            newTotalAssignedAmount > 0 &&
                newTotalAssignedAmount <= MAX_TOKENS_ASSIGNED_PER_LICENSE,
            "Invalid license power"
        );
        require(
            totalLicensesAssignedTokensAmount + newTotalAssignedAmount <=
                MAX_MND_TOTAL_ASSIGNED_TOKENS,
            "Max total assigned tokens reached"
        );
        require(
            _supply.current() < MAX_MND_SUPPLY,
            "Maximum token supply reached"
        );
        require(balanceOf(to) == 0, "User already has a license");

        uint256 tokenId = safeMint(to);
        totalLicensesAssignedTokensAmount += newTotalAssignedAmount;
        licenses[tokenId] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            assignTimestamp: 0,
            totalAssignedAmount: newTotalAssignedAmount,
            lastClaimOracle: address(0)
        });

        emit LicenseCreated(to, tokenId, newTotalAssignedAmount);
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
            !registeredNodeAddresses[newNodeAddress] &&
                !_ndContract.registeredNodeAddresses(newNodeAddress),
            "Node address already registered"
        );

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
        require(
            license.lastClaimEpoch == getCurrentEpoch(),
            "Cannot unlink before claiming rewards"
        );

        address oldNodeAddress = license.nodeAddress;
        registeredNodeAddresses[license.nodeAddress] = false;
        license.nodeAddress = address(0);

        emit UnlinkNode(msg.sender, licenseId, oldNodeAddress);
    }

    function claimRewards(
        ComputeRewardsParams memory computeParam,
        bytes[] memory signatures
    ) public nonReentrant whenNotPaused {
        require(
            ownerOf(computeParam.licenseId) == msg.sender,
            "User does not have the license"
        );
        require(
            minimumRequiredSignatures <= signatures.length,
            "Insufficient signatures"
        );
        (bool validSignatures, address firstSigner) = verifyRewardsSignatures(
            computeParam,
            signatures
        );
        signerSignaturesCount[firstSigner]++;
        require(validSignatures, "Invalid signature");

        License storage license = licenses[computeParam.licenseId];
        uint256 rewardsAmount = calculateLicenseRewards(license, computeParam);

        license.lastClaimEpoch = getCurrentEpoch();
        license.totalClaimedAmount += rewardsAmount;
        license.lastClaimOracle = firstSigner;

        if (rewardsAmount > 0) {
            if (computeParam.licenseId == GENESIS_TOKEN_ID) {
                mintCompanyFunds(rewardsAmount);
            } else {
                _naeuraToken.mint(msg.sender, rewardsAmount);
            }
        }
    }

    function mintCompanyFunds(uint256 amount) private {
        _naeuraToken.mint(
            lpWallet,
            (amount * LP_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _naeuraToken.mint(
            expensesWallet,
            (amount * EXPENSES_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _naeuraToken.mint(
            marketingWallet,
            (amount * MARKETING_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _naeuraToken.mint(
            grantsWallet,
            (amount * GRANTS_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _naeuraToken.mint(
            csrWallet,
            (amount * CSR_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
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
        uint256 currentEpoch = getCurrentEpoch();
        uint256 licenseRewards = 0;

        if (currentEpoch < CLIFF_EPOCHS) {
            return 0;
        }

        require(
            license.nodeAddress == computeParam.nodeAddress,
            "Invalid node address."
        );

        if (license.totalClaimedAmount == license.totalAssignedAmount) {
            return 0;
        }

        uint256 firstEpochToClaim = (computeParam.licenseId ==
            GENESIS_TOKEN_ID ||
            license.lastClaimEpoch >= CLIFF_EPOCHS)
            ? license.lastClaimEpoch
            : CLIFF_EPOCHS;
        uint256 epochsToClaim = currentEpoch - firstEpochToClaim;
        if (epochsToClaim == 0) {
            return 0;
        }

        require(
            computeParam.epochs.length == epochsToClaim &&
                computeParam.availabilies.length == epochsToClaim,
            "Incorrect number of params."
        );

        uint256 maxRewardsPerEpoch = license.totalAssignedAmount /
            (
                computeParam.licenseId == GENESIS_TOKEN_ID
                    ? GENESIS_UNLOCK_EPOCHS
                    : VESTING_DURATION_EPOCHS
            );
        for (uint256 i = 0; i < epochsToClaim; i++) {
            licenseRewards +=
                (maxRewardsPerEpoch * computeParam.availabilies[i]) /
                MAX_AVAILABILITY;
        }

        uint256 maxRemainingClaimAmount = license.totalAssignedAmount -
            license.totalClaimedAmount;
        if (licenseRewards > maxRemainingClaimAmount) {
            return maxRemainingClaimAmount;
        }
        return licenseRewards;
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
    ) internal override(ERC721Enumerable) whenNotPaused {
        require(
            from == address(0) || to == address(0),
            "Soulbound: Non-transferable token"
        );
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function setCompanyWallets(
        address newLpWallet,
        address newExpensesWallet,
        address newMarketingWallet,
        address newGrantsWallet,
        address newCsrWallet
    ) public onlyOwner {
        lpWallet = newLpWallet;
        expensesWallet = newExpensesWallet;
        marketingWallet = newMarketingWallet;
        grantsWallet = newGrantsWallet;
        csrWallet = newCsrWallet;
    }

    function setNDContract(address ndContract_) public onlyOwner {
        _ndContract = IND(ndContract_);
    }

    function setMinimumRequiredSignatures(
        uint8 minimumRequiredSignatures_
    ) public onlyOwner {
        minimumRequiredSignatures = minimumRequiredSignatures_;
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
                    totalAssignedAmount: 0,
                    lastClaimOracle: address(0)
                });
        }
        uint256 licenseId = tokenOfOwnerByIndex(addr, 0);
        License memory license = licenses[licenseId];

        uint256 firstEpochToClaim = (licenseId == GENESIS_TOKEN_ID ||
            license.lastClaimEpoch >= CLIFF_EPOCHS)
            ? license.lastClaimEpoch
            : CLIFF_EPOCHS;
        uint256 claimableEpochs = getCurrentEpoch() - firstEpochToClaim;

        return
            LicenseInfo({
                licenseId: licenseId,
                nodeAddress: license.nodeAddress,
                totalAssignedAmount: license.totalAssignedAmount,
                totalClaimedAmount: license.totalClaimedAmount,
                remainingAmount: license.totalAssignedAmount -
                    license.totalClaimedAmount,
                lastClaimEpoch: license.lastClaimEpoch,
                claimableEpochs: claimableEpochs,
                assignTimestamp: license.assignTimestamp,
                lastClaimOracle: license.lastClaimOracle
            });
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifySignatures(
        bytes32 ethSignedMessageHash,
        bytes[] memory signatures
    ) internal view returns (bool, address) {
        for (uint i = 0; i < signatures.length; i++) {
            if (!isSigner[ethSignedMessageHash.recover(signatures[i])]) {
                return (false, address(0));
            }
        }
        return (true, ethSignedMessageHash.recover(signatures[0]));
    }

    function verifyRewardsSignatures(
        ComputeRewardsParams memory computeParam,
        bytes[] memory signatures
    ) public view returns (bool, address) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                computeParam.nodeAddress,
                computeParam.epochs,
                computeParam.availabilies
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return verifySignatures(ethSignedMessageHash, signatures);
    }

    function addSigner(address newSigner) public onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        require(!isSigner[newSigner], "Signer already exists");
        isSigner[newSigner] = true;
        signerAdditionTimestamp[newSigner] = block.timestamp;
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
