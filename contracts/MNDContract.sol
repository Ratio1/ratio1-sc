// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721URIStorageUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SD59x18, sd, unwrap, add, sub, mul, div, exp} from "@prb/math/src/SD59x18.sol";
import "./R1.sol";
import "./Controller.sol";

interface IND {
    function registeredNodeAddresses(address node) external view returns (bool);
}

interface IAdoptionOracle {
    function getAdoptionPercentagesRange(
        uint256 fromEpoch,
        uint256 toEpoch
    ) external view returns (uint8[] memory);
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

struct RewardsCalculation {
    uint256 rewardsAmount;
    uint256 vestedAmount;
    uint256 awbBalanceAfter;
}

struct MndRewardsState {
    uint256 awbBalance;
    uint256 cumulativeVested;
    uint256 rewardsAmount;
    uint256 vestedAmount;
    uint256 totalAssignedAmount;
    uint8 carryoverFactor;
}

struct License {
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 firstMiningEpoch;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
}

struct LicenseInfo {
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

contract MNDContract is
    Initializable,
    ERC721EnumerableUpgradeable,
    ERC721URIStorageUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    //..######...#######..##....##..######..########....###....##....##.########..######.
    //.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
    //.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
    //.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
    //.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
    //.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
    //..######...#######..##....##..######.....##....##.....##.##....##....##.....######.

    uint256 constant MAX_PERCENTAGE = 100_00;
    uint8 constant MAX_AVAILABILITY = 255;
    uint8 constant MAX_ADOPTION_PERCENTAGE = 255;
    uint256 public constant GENESIS_TOKEN_ID = 1;
    int256 private constant WAD = 1e18;
    SD59x18 private LOGISTIC_PLATEAU;
    SD59x18 private K;
    SD59x18 private MID_PRC;

    uint256 constant LP_WALLET_PERCENTAGE = 26_71;
    uint256 constant EXPENSES_WALLET_PERCENTAGE = 13_84;
    uint256 constant MARKETING_WALLET_PERCENTAGE = 7_54;
    uint256 constant GRANTS_WALLET_PERCENTAGE = 34_60;
    uint256 constant CSR_WALLET_PERCENTAGE = 17_31;

    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    uint256 private _supply;
    string public _baseTokenURI;

    R1 private _R1Token;
    Controller public _controller;
    IND _ndContract;
    address lpWallet;
    address expensesWallet;
    address marketingWallet;
    address grantsWallet;
    address csrWallet;

    uint256 public totalLicensesAssignedTokensAmount;
    mapping(uint256 => License) public licenses;
    mapping(address => bool) public registeredNodeAddresses;
    mapping(address => uint256) public nodeToLicenseId;

    mapping(address => address) public initiatedTransferReceiver;
    mapping(address => bool) public initiatedBurn;

    IAdoptionOracle public adoptionOracle;
    mapping(uint256 => uint256) public awbBalances;
    uint8 public maxCarryoverReleaseFactor;

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
    event RewardsClaimed(
        address indexed to,
        uint256 indexed licenseId,
        uint256 rewardsAmount,
        uint256 totalEpochs
    );
    event AdoptionOracleUpdated(address indexed adoptionOracle);
    event MaxCarryoverReleaseFactorUpdated(uint8 newFactor);

    function initialize(
        address tokenAddress,
        address controllerAddress,
        address newOwner
    ) public initializer {
        __ERC721_init("MNDLicense", "MND");
        __ERC721Enumerable_init();
        __ERC721URIStorage_init();
        __Pausable_init();
        __Ownable_init(newOwner);
        __ReentrancyGuard_init();

        _R1Token = R1(tokenAddress);
        _controller = Controller(controllerAddress);

        LOGISTIC_PLATEAU = sd(300_505239501691000000); // 392.77
        K = sd(5e18); // 5
        MID_PRC = sd(7e17); // 0.7
        maxCarryoverReleaseFactor = MAX_ADOPTION_PERCENTAGE;

        // Mint the first Genesis Node Deed
        uint256 tokenId = safeMint(newOwner);
        uint256 GENESIS_TOTAL_EMISSION = _controller.GND_TOTAL_EMISSION();
        licenses[tokenId] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            firstMiningEpoch: 1,
            assignTimestamp: 0,
            totalAssignedAmount: GENESIS_TOTAL_EMISSION,
            lastClaimOracle: address(0)
        });
        emit LicenseCreated(newOwner, tokenId, GENESIS_TOTAL_EMISSION);
    }

    function addLicense(
        address to,
        uint256 newTotalAssignedAmount
    ) public onlyOwner whenNotPaused {
        require(
            newTotalAssignedAmount > 0 &&
                newTotalAssignedAmount <=
                _controller.MND_MAX_TOKENS_ASSIGNED_PER_LICENSE(),
            "Invalid license power"
        );
        require(
            getUserTotalAssignedAmount(to) + newTotalAssignedAmount <=
                _controller.MND_MAX_TOKENS_ASSIGNED_PER_LICENSE(),
            "Assigned amount for address exceedes limit"
        );
        require(
            totalLicensesAssignedTokensAmount + newTotalAssignedAmount <=
                _controller.MND_MAX_TOTAL_ASSIGNED_TOKENS(),
            "Max total assigned tokens reached"
        );

        uint256 tokenId = safeMint(to);
        totalLicensesAssignedTokensAmount += newTotalAssignedAmount;
        uint256 noMiningEpochs = _controller.MND_NO_MINING_EPOCHS();
        uint256 currentEpoch = getCurrentEpoch();
        uint256 firstMiningEpoch = (currentEpoch >= noMiningEpochs)
            ? currentEpoch
            : noMiningEpochs;
        licenses[tokenId] = License({
            nodeAddress: address(0),
            lastClaimEpoch: 0,
            totalClaimedAmount: 0,
            firstMiningEpoch: firstMiningEpoch,
            assignTimestamp: 0,
            totalAssignedAmount: newTotalAssignedAmount,
            lastClaimOracle: address(0)
        });

        emit LicenseCreated(to, tokenId, newTotalAssignedAmount);
    }

    function linkNode(
        uint256 licenseId,
        address newNodeAddress,
        bytes memory signature
    ) public whenNotPaused {
        verifyLinkNodeSignature(msg.sender, newNodeAddress, signature);
        _linkNodeInternal(licenseId, newNodeAddress);
    }

    function linkMultiNode(
        uint256[] memory licenseIds,
        address[] memory newNodeAddresses,
        bytes memory signature
    ) public whenNotPaused {
        require(
            licenseIds.length == newNodeAddresses.length,
            "Mismatched input arrays length"
        );

        verifyLinkMultiNodeSignature(msg.sender, newNodeAddresses, signature);

        for (uint256 i = 0; i < licenseIds.length; i++) {
            _linkNodeInternal(licenseIds[i], newNodeAddresses[i]);
        }
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
        uint256 currentEpoch = getCurrentEpoch();
        require(
            license.lastClaimEpoch == currentEpoch ||
                currentEpoch < _controller.MND_NO_MINING_EPOCHS(),
            "Cannot unlink before claiming rewards"
        );

        address oldNodeAddress = license.nodeAddress;
        registeredNodeAddresses[license.nodeAddress] = false;
        nodeToLicenseId[license.nodeAddress] = 0;
        license.nodeAddress = address(0);

        emit UnlinkNode(msg.sender, licenseId, oldNodeAddress);
    }

    function _linkNodeInternal(uint256 licenseId, address newNodeAddress) private {
        require(
            ownerOf(licenseId) == msg.sender,
            "Not the owner of the license"
        );
        require(newNodeAddress != address(0), "Invalid node address");
        require(
            !isNodeAlreadyLinked(newNodeAddress),
            "Node address already registered"
        );

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
        nodeToLicenseId[newNodeAddress] = licenseId;

        emit LinkNode(msg.sender, licenseId, newNodeAddress);
    }

    function claimRewards(
        ComputeRewardsParams[] memory computeParams,
        bytes[][] memory nodesSignatures
    ) public nonReentrant whenNotPaused {
        require(
            computeParams.length == nodesSignatures.length,
            "Mismatched input arrays length"
        );

        uint256 totalRewards = 0;
        for (uint256 i = 0; i < computeParams.length; i++) {
            require(
                ownerOf(computeParams[i].licenseId) == msg.sender,
                "User does not have the license"
            );
            address firstSigner = verifyRewardsSignatures(
                computeParams[i],
                nodesSignatures[i]
            );

            License storage license = licenses[computeParams[i].licenseId];
            RewardsCalculation memory calc = _calculateLicenseRewards(
                license,
                computeParams[i],
                awbBalances[computeParams[i].licenseId]
            );

            license.lastClaimEpoch = getCurrentEpoch();
            license.totalClaimedAmount += calc.vestedAmount;
            license.lastClaimOracle = firstSigner;
            if (calc.awbBalanceAfter != awbBalances[computeParams[i].licenseId]) {
                awbBalances[computeParams[i].licenseId] = calc.awbBalanceAfter;
            }
            if (calc.rewardsAmount > 0) {
                emit RewardsClaimed(
                    msg.sender,
                    computeParams[i].licenseId,
                    calc.rewardsAmount,
                    computeParams[i].epochs.length
                );
                if (computeParams[i].licenseId == GENESIS_TOKEN_ID) {
                    mintCompanyFunds(calc.rewardsAmount);
                } else {
                    totalRewards += calc.rewardsAmount;
                }
            }
        }

        if (totalRewards > 0) {
            _R1Token.mint(msg.sender, totalRewards);
        }
    }

    function mintCompanyFunds(uint256 amount) private {
        _R1Token.mint(
            lpWallet,
            (amount * LP_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.mint(
            expensesWallet,
            (amount * EXPENSES_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.mint(
            marketingWallet,
            (amount * MARKETING_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.mint(
            grantsWallet,
            (amount * GRANTS_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.mint(
            csrWallet,
            (amount * CSR_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
    }

    function calculateRewards(
        ComputeRewardsParams[] memory computeParams
    ) public view returns (ComputeRewardsResult[] memory) {
        ComputeRewardsResult[] memory results = new ComputeRewardsResult[](
            computeParams.length
        );

        for (uint256 i = 0; i < computeParams.length; i++) {
            ComputeRewardsParams memory params = computeParams[i];
            License memory license = licenses[params.licenseId];
            RewardsCalculation memory calc = _calculateLicenseRewards(
                license,
                params,
                awbBalances[params.licenseId]
            );
            results[i] = ComputeRewardsResult({
                licenseId: params.licenseId,
                rewardsAmount: calc.rewardsAmount
            });
        }

        return results;
    }

    function _calculateLicenseRewards(
        License memory license,
        ComputeRewardsParams memory computeParam,
        uint256 awbBalance
    ) internal view returns (RewardsCalculation memory) {
        RewardsCalculation memory result;
        uint256 currentEpoch = getCurrentEpoch();

        if (computeParam.licenseId != GENESIS_TOKEN_ID) {
            require(
                address(adoptionOracle) != address(0),
                "Adoption oracle not set"
            );
            if (
                license.totalClaimedAmount >= license.totalAssignedAmount &&
                awbBalance == 0
            ) {
                return result;
            }
        }

        if (currentEpoch < license.firstMiningEpoch) {
            return result;
        }

        require(
            license.nodeAddress == computeParam.nodeAddress,
            "Invalid node address."
        );

        uint256 firstEpochToClaim = (license.lastClaimEpoch >=
            license.firstMiningEpoch)
            ? license.lastClaimEpoch
            : license.firstMiningEpoch;
        uint256 epochsToClaim = currentEpoch - firstEpochToClaim;
        if (epochsToClaim == 0) {
            return result;
        }

        require(
            computeParam.epochs.length == epochsToClaim &&
                computeParam.availabilies.length == epochsToClaim,
            "Incorrect number of params."
        );
        require(
            computeParam.epochs[computeParam.epochs.length - 1] ==
                currentEpoch - 1,
            "Invalid epochs"
        );

        if (computeParam.licenseId == GENESIS_TOKEN_ID) {
            return
                _calculateGenesisRewards(
                    license,
                    computeParam,
                    epochsToClaim,
                    awbBalance
                );
        }

        return
            _calculateMndRewards(
                license,
                computeParam,
                awbBalance,
                firstEpochToClaim,
                epochsToClaim,
                currentEpoch
            );
    }

    function _calculateGenesisRewards(
        License memory license,
        ComputeRewardsParams memory computeParam,
        uint256 epochsToClaim,
        uint256 awbBalance
    ) internal view returns (RewardsCalculation memory) {
        RewardsCalculation memory result;
        uint256 maxRemainingClaimAmount = license.totalAssignedAmount -
            license.totalClaimedAmount;
        if (maxRemainingClaimAmount == 0) {
            return result;
        }
        uint256 maxRewardsPerEpoch = license.totalAssignedAmount /
            _controller.GND_MINING_EPOCHS();
        for (uint256 i = 0; i < epochsToClaim; i++) {
            result.rewardsAmount +=
                (maxRewardsPerEpoch * computeParam.availabilies[i]) /
                MAX_AVAILABILITY;
        }
        if (result.rewardsAmount > maxRemainingClaimAmount) {
            result.rewardsAmount = maxRemainingClaimAmount;
        }
        result.vestedAmount = result.rewardsAmount;
        result.awbBalanceAfter = awbBalance;
        return result;
    }

    function _calculateMndRewards(
        License memory license,
        ComputeRewardsParams memory computeParam,
        uint256 awbBalance,
        uint256 firstEpochToClaim,
        uint256 epochsToClaim,
        uint256 currentEpoch
    ) internal view returns (RewardsCalculation memory) {
        SD59x18 licensePlateau = div(
            sd(int256(license.totalAssignedAmount)),
            LOGISTIC_PLATEAU
        );
        uint8[] memory adoptionPercentages = adoptionOracle
            .getAdoptionPercentagesRange(firstEpochToClaim, currentEpoch - 1);
        MndRewardsState memory state = MndRewardsState({
            awbBalance: awbBalance,
            cumulativeVested: license.totalClaimedAmount,
            rewardsAmount: 0,
            vestedAmount: 0,
            totalAssignedAmount: license.totalAssignedAmount,
            carryoverFactor: maxCarryoverReleaseFactor
        });

        for (uint256 i = 0; i < epochsToClaim; i++) {
            require(
                computeParam.epochs[i] == firstEpochToClaim + i,
                "Invalid epochs"
            );
            uint256 maxRewardsPerEpoch = calculateEpochRelease(
                computeParam.epochs[i],
                license.firstMiningEpoch,
                licensePlateau
            );
            state = _applyEpochRewards(
                state,
                maxRewardsPerEpoch,
                computeParam.availabilies[i],
                adoptionPercentages[i]
            );
        }

        return
            RewardsCalculation({
                rewardsAmount: state.rewardsAmount,
                vestedAmount: state.vestedAmount,
                awbBalanceAfter: state.awbBalance
            });
    }

    function _applyEpochRewards(
        MndRewardsState memory state,
        uint256 maxRewardsPerEpoch,
        uint8 availability,
        uint8 adoptionPercentage
    ) internal pure returns (MndRewardsState memory) {
        uint256 availabilityAdjusted = (maxRewardsPerEpoch * availability) /
            MAX_AVAILABILITY;
        uint256 remainingToVest = 0;
        if (state.totalAssignedAmount > state.cumulativeVested) {
            remainingToVest =
                state.totalAssignedAmount -
                state.cumulativeVested;
        }
        if (availabilityAdjusted > remainingToVest) {
            availabilityAdjusted = remainingToVest;
        }

        uint256 adoptionGated = (availabilityAdjusted * adoptionPercentage) /
            MAX_ADOPTION_PERCENTAGE;
        state.awbBalance += availabilityAdjusted - adoptionGated;
        state.cumulativeVested += availabilityAdjusted;
        state.vestedAmount += availabilityAdjusted;

        uint256 targetWithheld = (state.cumulativeVested *
            (MAX_ADOPTION_PERCENTAGE - adoptionPercentage)) /
            MAX_ADOPTION_PERCENTAGE;
        uint256 excessWithheld = state.awbBalance > targetWithheld
            ? state.awbBalance - targetWithheld
            : 0;
        uint256 carryoverCap = (maxRewardsPerEpoch *
            state.carryoverFactor) /
            MAX_ADOPTION_PERCENTAGE;
        uint256 carryoverRelease = excessWithheld > carryoverCap
            ? carryoverCap
            : excessWithheld;
        if (carryoverRelease > 0) {
            state.awbBalance -= carryoverRelease;
        }
        state.rewardsAmount += adoptionGated + carryoverRelease;
        return state;
    }

    function calculateEpochRelease(
        uint256 currentEpoch,
        uint256 firstMiningEpoch,
        SD59x18 plateau
    ) internal view returns (uint256) {
        uint256 x = currentEpoch - firstMiningEpoch;
        if (x > _controller.MND_MINING_DURATION_EPOCHS()) {
            x = _controller.MND_MINING_DURATION_EPOCHS();
        }
        SD59x18 frac = _logisticFraction(x);
        return uint256(mul(plateau, frac).unwrap());
    }

    function _logisticFraction(uint256 xInt) internal view returns (SD59x18) {
        SD59x18 x = sd(int256(xInt) * WAD);
        SD59x18 length = sd(
            int256(_controller.MND_MINING_DURATION_EPOCHS()) * WAD
        );
        SD59x18 midpoint = mul(length, MID_PRC);
        SD59x18 exponent = mul(div(sub(x, midpoint), length), K);
        exponent = sd(-exponent.unwrap());
        SD59x18 one = sd(int256(WAD));
        return div(one, add(one, exp(exponent)));
    }

    function initiateTransfer(address from, address to) public onlyOwner {
        initiatedTransferReceiver[from] = to;
    }

    function initiateBurn(address from) public onlyOwner {
        initiatedBurn[from] = true;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function safeMint(address to) private returns (uint256) {
        _supply += 1;
        uint256 newTokenId = _supply;
        require(
            newTokenId <= _controller.MND_MAX_SUPPLY(),
            "Maximum token supply reached."
        );

        _safeMint(to, newTokenId);
        return newTokenId;
    }

    function getCurrentEpoch() public view returns (uint256) {
        return _calculateEpoch(block.timestamp);
    }

    function _calculateEpoch(uint256 timestamp) private view returns (uint256) {
        uint256 startEpochTimestamp = _controller.startEpochTimestamp();
        uint256 epochDuration = _controller.epochDuration();
        require(
            timestamp >= startEpochTimestamp,
            "Timestamp is before the start epoch."
        );

        return (timestamp - startEpochTimestamp) / epochDuration;
    }

    function setBaseURI(string memory baseURI) public onlyOwner {
        _baseTokenURI = baseURI;
    }

    function tokenURI(
        uint256 tokenId
    )
        public
        view
        override(ERC721Upgradeable, ERC721URIStorageUpgradeable)
        returns (string memory)
    {
        require(
            _ownerOf(tokenId) != address(0),
            "ERC721Metadata: URI query for nonexistent token"
        );
        return _baseTokenURI;
    }

    function burn(uint256 tokenId) public whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not the owner of the license");
        _burn(tokenId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    )
        internal
        override(ERC721Upgradeable, ERC721EnumerableUpgradeable)
        returns (address)
    {
        address from = _ownerOf(tokenId);

        require(
            from == address(0) ||
                (to == address(0) && initiatedBurn[from]) ||
                (to != address(0) && initiatedTransferReceiver[from] == to),
            "Soulbound: Non-transferable token"
        );
        delete initiatedTransferReceiver[from];
        delete initiatedBurn[from];
        License memory license = licenses[tokenId];
        if (to == address(0)) {
            uint256 remainingAmount = license.totalAssignedAmount -
                license.totalClaimedAmount;
            totalLicensesAssignedTokensAmount -= remainingAmount;
            registeredNodeAddresses[license.nodeAddress] = false;
            nodeToLicenseId[license.nodeAddress] = 0;
            delete awbBalances[tokenId];
            delete licenses[tokenId];
        } else {
            require(
                getUserTotalAssignedAmount(to) + license.totalAssignedAmount <=
                    _controller.MND_MAX_TOKENS_ASSIGNED_PER_LICENSE(),
                "Assigned amount for address exceedes limit"
            );
        }
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721EnumerableUpgradeable, ERC721URIStorageUpgradeable)
        returns (bool)
    {
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

    function setAdoptionOracle(address adoptionOracle_) public onlyOwner {
        require(adoptionOracle_ != address(0), "Invalid adoption oracle");
        adoptionOracle = IAdoptionOracle(adoptionOracle_);
        emit AdoptionOracleUpdated(adoptionOracle_);
    }

    function setMaxCarryoverReleaseFactor(
        uint8 newFactor
    ) public onlyOwner {
        maxCarryoverReleaseFactor = newFactor;
        emit MaxCarryoverReleaseFactorUpdated(newFactor);
    }

    function setMNDReleaseParams(
        int256 _logisticPlateau,
        int256 _k,
        int256 _midPrc
    ) public onlyOwner {
        LOGISTIC_PLATEAU = sd(_logisticPlateau);
        K = sd(_k);
        MID_PRC = sd(_midPrc);
    }

    //.##.....##.####.########.##......##....########.##.....##.##....##..######..########.####..#######..##....##..######.
    //.##.....##..##..##.......##..##..##....##.......##.....##.###...##.##....##....##.....##..##.....##.###...##.##....##
    //.##.....##..##..##.......##..##..##....##.......##.....##.####..##.##..........##.....##..##.....##.####..##.##......
    //.##.....##..##..######...##..##..##....######...##.....##.##.##.##.##..........##.....##..##.....##.##.##.##..######.
    //..##...##...##..##.......##..##..##....##.......##.....##.##..####.##..........##.....##..##.....##.##..####.......##
    //...##.##....##..##.......##..##..##....##.......##.....##.##...###.##....##....##.....##..##.....##.##...###.##....##
    //....###....####.########..###..###.....##........#######..##....##..######.....##....####..#######..##....##..######.

    function getLicenses(
        address addr
    ) public view returns (LicenseInfo[] memory) {
        uint256 balance = balanceOf(addr);
        LicenseInfo[] memory licensesInfo = new LicenseInfo[](balance);
        uint256 currentEpoch = getCurrentEpoch();

        for (uint256 i = 0; i < balance; i++) {
            uint256 licenseId = tokenOfOwnerByIndex(addr, i);
            License memory license = licenses[licenseId];

            uint256 firstEpochToClaim = (license.lastClaimEpoch >=
                license.firstMiningEpoch)
                ? license.lastClaimEpoch
                : license.firstMiningEpoch;
            uint256 claimableEpochs = (currentEpoch < firstEpochToClaim ||
                license.nodeAddress == address(0))
                ? 0
                : currentEpoch - firstEpochToClaim;

            licensesInfo[i] = LicenseInfo({
                licenseId: licenseId,
                nodeAddress: license.nodeAddress,
                totalAssignedAmount: license.totalAssignedAmount,
                totalClaimedAmount: license.totalClaimedAmount,
                firstMiningEpoch: license.firstMiningEpoch,
                remainingAmount: license.totalAssignedAmount -
                    license.totalClaimedAmount,
                lastClaimEpoch: license.lastClaimEpoch,
                claimableEpochs: claimableEpochs,
                assignTimestamp: license.assignTimestamp,
                lastClaimOracle: license.lastClaimOracle
            });
        }

        return licensesInfo;
    }

    function getUserTotalAssignedAmount(
        address addr
    ) public view returns (uint256) {
        uint256 balance = balanceOf(addr);
        uint256 userTotalAssignedAmount = 0;

        for (uint256 i = 0; i < balance; i++) {
            uint256 licenseId = tokenOfOwnerByIndex(addr, i);
            License memory license = licenses[licenseId];
            userTotalAssignedAmount += license.totalAssignedAmount;
        }
        return userTotalAssignedAmount;
    }

    function isNodeAlreadyLinked(
        address nodeAddress
    ) public view returns (bool) {
        return
            registeredNodeAddresses[nodeAddress] ||
            _ndContract.registeredNodeAddresses(nodeAddress);
    }

    function isNodeActive(address nodeAddress) public view returns (bool) {
        return registeredNodeAddresses[nodeAddress];
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifyRewardsSignatures(
        ComputeRewardsParams memory computeParam,
        bytes[] memory signatures
    ) public returns (address) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                computeParam.nodeAddress,
                computeParam.epochs,
                computeParam.availabilies
            )
        );
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(
            messageHash
        );
        return
            _controller.requireVerifySignatures(
                ethSignedMessageHash,
                signatures,
                true
            );
    }

    function verifyLinkNodeSignature(
        address addr,
        address nodeAddress,
        bytes memory signature
    ) internal returns (address) {
        bytes32 messageHash = keccak256(abi.encodePacked(addr, nodeAddress));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(
            messageHash
        );
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = signature;
        return
            _controller.requireVerifySignatures(
                ethSignedMessageHash,
                signatures,
                false
            );
    }

    function verifyLinkMultiNodeSignature(
        address addr,
        address[] memory nodeAddresses,
        bytes memory signature
    ) internal returns (address) {
        bytes32 messageHash = keccak256(abi.encodePacked(addr, nodeAddresses));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(
            messageHash
        );
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = signature;
        return
            _controller.requireVerifySignatures(
                ethSignedMessageHash,
                signatures,
                false
            );
    }
}
