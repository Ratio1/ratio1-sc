// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ILiquidityManager.sol";
import "./R1.sol";
import "./Controller.sol";

interface IMND {
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

struct PriceTier {
    uint256 usdPrice; // Price in USD
    uint256 totalUnits; // Number of units available at this stage
    uint256 soldUnits; // Number of units sold at this stage
}

struct License {
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
    bool isBanned;
}

struct LicenseInfo {
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

contract NDContract is
    ERC721Enumerable,
    ERC721URIStorage,
    Pausable,
    Ownable,
    ReentrancyGuard
{
    using SafeMath for uint256;
    using Counters for Counters.Counter;

    //..######...#######..##....##..######..########....###....##....##.########..######.
    //.##....##.##.....##.###...##.##....##....##......##.##...###...##....##....##....##
    //.##.......##.....##.####..##.##..........##.....##...##..####..##....##....##......
    //.##.......##.....##.##.##.##..######.....##....##.....##.##.##.##....##.....######.
    //.##.......##.....##.##..####.......##....##....#########.##..####....##..........##
    //.##....##.##.....##.##...###.##....##....##....##.....##.##...###....##....##....##
    //..######...#######..##....##..######.....##....##.....##.##....##....##.....######.

    uint256 constant MAX_PERCENTAGE = 100_00;
    uint8 constant MAX_AVAILABILITY = 255;

    uint256 constant PRICE_DECIMALS = 10 ** 18;

    uint8 constant LAST_PRICE_TIER = 12;

    uint256 constant BURN_PERCENTAGE = 20_00;
    uint256 constant LIQUIDITY_PERCENTAGE = 50_00;
    uint256 constant COMPANY_PERCENTAGE = 30_00;

    //..######..########..#######..########.....###.....######...########
    //.##....##....##....##.....##.##.....##...##.##...##....##..##......
    //.##..........##....##.....##.##.....##..##...##..##........##......
    //..######.....##....##.....##.########..##.....##.##...####.######..
    //.......##....##....##.....##.##...##...#########.##....##..##......
    //.##....##....##....##.....##.##....##..##.....##.##....##..##......
    //..######.....##.....#######..##.....##.##.....##..######...########

    Counters.Counter private _supply;
    string private _baseTokenURI;
    uint8 public currentPriceTier;

    R1 public _R1Token;
    Controller public _controller;
    ILiquidityManager _liquidityManager;
    IMND _mndContract;
    address lpWallet;
    address companyWallet;

    mapping(uint8 => PriceTier) public _priceTiers;
    mapping(uint256 => License) public licenses;
    mapping(address => bool) public registeredNodeAddresses;
    mapping(address => uint256) public nodeToLicenseId;
    mapping(address => uint256) public userUsdMintedAmount;
    mapping(bytes32 => bool) public usedInvoiceUUIDs;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event LicensesCreated(
        address indexed to,
        bytes32 indexed invoiceUuid,
        uint256 tokenCount,
        uint256 unitUsdPrice,
        uint256 totalR1Cost
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
    event LpAddrChanged(address newlpAddr);
    event LiquidityAdded(uint256 tokenAmount, uint256 ethAmount);

    constructor(
        address tokenAddress,
        address controllerAddress,
        address newOwner
    ) ERC721("NDLicense", "ND") {
        _R1Token = R1(tokenAddress);
        _controller = Controller(controllerAddress);
        transferOwnership(newOwner);

        initializePriceTiers();
    }

    function initializePriceTiers() private {
        _priceTiers[1] = PriceTier(500, 89, 0);
        _priceTiers[2] = PriceTier(750, 144, 0);
        _priceTiers[3] = PriceTier(1000, 233, 0);
        _priceTiers[4] = PriceTier(1500, 377, 0);
        _priceTiers[5] = PriceTier(2000, 610, 0);
        _priceTiers[6] = PriceTier(2500, 987, 0);
        _priceTiers[7] = PriceTier(3000, 1597, 0);
        _priceTiers[8] = PriceTier(3500, 2584, 0);
        _priceTiers[9] = PriceTier(4000, 4181, 0);
        _priceTiers[10] = PriceTier(5000, 6765, 0);
        _priceTiers[11] = PriceTier(7000, 10946, 0);
        _priceTiers[12] = PriceTier(9500, 17711, 0);

        uint256 ndSupply = 0;
        for (uint8 i = 1; i <= LAST_PRICE_TIER; i++) {
            ndSupply += _priceTiers[i].totalUnits;
        }
        require(
            ndSupply == _controller.ND_MAX_LICENSE_SUPPLY(),
            "Invalid license supply"
        );

        currentPriceTier = 1;
    }

    function buyLicense(
        uint256 nLicensesToBuy,
        uint8 requestedPriceTier,
        uint256 maxAcceptedTokenPerLicense,
        bytes32 invoiceUuid,
        uint256 usdMintLimit,
        bytes memory signature
    ) public nonReentrant whenNotPaused returns (uint) {
        require(
            currentPriceTier <= LAST_PRICE_TIER,
            "All licenses have been sold"
        );
        require(
            requestedPriceTier == currentPriceTier,
            "Not in the right price tier"
        );
        require(nLicensesToBuy > 0, "Invalid number of licenses");
        require(
            !usedInvoiceUUIDs[invoiceUuid],
            "Invoice UUID has already been used"
        );
        verifyBuyLicenseSignature(
            msg.sender,
            invoiceUuid,
            usdMintLimit,
            signature
        );

        usedInvoiceUUIDs[invoiceUuid] = true;
        PriceTier storage priceTier = _priceTiers[currentPriceTier];
        uint256 buyableUnits = getPriceTierBuyableUnits(
            priceTier,
            nLicensesToBuy
        );
        uint256 licenseTokenPrice = getLicenseTokenPrice();
        require(
            licenseTokenPrice <= maxAcceptedTokenPerLicense,
            "Price exceeds max accepted"
        );
        uint256 totalTokenCost = buyableUnits * licenseTokenPrice;
        uint256 totalUsdCost = buyableUnits * priceTier.usdPrice;

        // Check user's mint limit
        require(
            userUsdMintedAmount[msg.sender] + totalUsdCost <= usdMintLimit,
            "Exceeds mint limit"
        );
        userUsdMintedAmount[msg.sender] += totalUsdCost;

        // Transfer R1 tokens from user to contract
        require(
            _R1Token.transferFrom(msg.sender, address(this), totalTokenCost),
            "R1 transfer failed"
        );
        distributePayment(totalTokenCost);

        uint256[] memory mintedTokens = batchMint(msg.sender, buyableUnits);

        priceTier.soldUnits += mintedTokens.length;
        if (priceTier.soldUnits == priceTier.totalUnits) {
            currentPriceTier++;
        } else if (priceTier.soldUnits > priceTier.totalUnits) {
            revert("Price tier sold more than available units");
        }

        emit LicensesCreated(
            msg.sender,
            invoiceUuid,
            mintedTokens.length,
            priceTier.usdPrice,
            totalTokenCost
        );

        return mintedTokens.length;
    }

    function getPriceTierBuyableUnits(
        PriceTier memory tier,
        uint256 requestedUnits
    ) private pure returns (uint256) {
        uint256 buyableUnits = tier.totalUnits - tier.soldUnits;
        return buyableUnits >= requestedUnits ? requestedUnits : buyableUnits;
    }

    function batchMint(
        address to,
        uint256 quantity
    ) private returns (uint256[] memory) {
        uint256[] memory tokenIds = new uint256[](quantity);

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = safeMint(to);
            tokenIds[i] = tokenId;
        }

        return tokenIds;
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
            !isNodeAlreadyLinked(newNodeAddress),
            "Node address already registered"
        );

        License storage license = licenses[licenseId];
        require(!license.isBanned, "License is banned, cannot perform action");
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
        require(!license.isBanned, "License is banned, cannot perform action");
        require(
            license.lastClaimEpoch == getCurrentEpoch(),
            "Cannot unlink before claiming rewards"
        );

        address oldNodeAddress = license.nodeAddress;
        registeredNodeAddresses[license.nodeAddress] = false;
        nodeToLicenseId[license.nodeAddress] = 0;
        license.nodeAddress = address(0);

        emit UnlinkNode(msg.sender, licenseId, oldNodeAddress);
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
            require(
                !license.isBanned,
                "License is banned, cannot perform action"
            );
            uint256 rewardsAmount = calculateLicenseRewards(
                license,
                computeParams[i]
            );

            license.lastClaimEpoch = getCurrentEpoch();
            license.totalClaimedAmount += rewardsAmount;
            license.lastClaimOracle = firstSigner;
            totalRewards += rewardsAmount;
            if (rewardsAmount > 0) {
                emit RewardsClaimed(
                    msg.sender,
                    computeParams[i].licenseId,
                    rewardsAmount,
                    computeParams[i].epochs.length
                );
            }
        }

        if (totalRewards > 0) {
            _R1Token.mint(msg.sender, totalRewards);
        }
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
            results[i] = ComputeRewardsResult({
                licenseId: params.licenseId,
                rewardsAmount: calculateLicenseRewards(license, params)
            });
        }

        return results;
    }

    function calculateLicenseRewards(
        License memory license,
        ComputeRewardsParams memory computeParam
    ) internal view returns (uint256) {
        uint256 currentEpoch = getCurrentEpoch();
        uint256 licenseRewards = 0;

        require(
            license.nodeAddress == computeParam.nodeAddress,
            "Invalid node address."
        );

        if (
            license.totalClaimedAmount ==
            _controller.ND_MAX_MINING_PER_LICENSE()
        ) {
            return 0;
        }

        uint256 epochsToClaim = currentEpoch - license.lastClaimEpoch;
        if (epochsToClaim == 0) {
            return 0;
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

        for (uint256 i = 0; i < epochsToClaim; i++) {
            licenseRewards +=
                (_controller.ND_MAX_RELEASE_PER_DAY() *
                    computeParam.availabilies[i]) /
                MAX_AVAILABILITY;
        }

        uint256 maxRemainingClaimAmount = _controller
            .ND_MAX_MINING_PER_LICENSE() - license.totalClaimedAmount;
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
        require(
            newTokenId <= _controller.ND_MAX_LICENSE_SUPPLY(),
            "Maximum token supply reached."
        );

        _safeMint(to, newTokenId);

        return newTokenId;
    }

    function distributePayment(uint256 amount) private {
        uint256 burnAmount = (amount * BURN_PERCENTAGE) / MAX_PERCENTAGE;
        uint256 liquidityAmount = (amount * LIQUIDITY_PERCENTAGE) /
            MAX_PERCENTAGE;
        uint256 companyAmount = (amount * COMPANY_PERCENTAGE) / MAX_PERCENTAGE;

        _R1Token.burn(address(this), burnAmount);
        _R1Token.transfer(companyWallet, companyAmount);
        addLiquidity(liquidityAmount);
    }

    // LP interactions
    function addLiquidity(uint256 r1Amount) private {
        _R1Token.approve(address(_liquidityManager), r1Amount);
        (uint256 usedAmountR1, uint256 usedAmountUsdc) = _liquidityManager
            .addLiquidity(r1Amount, lpWallet);

        emit LiquidityAdded(usedAmountR1, usedAmountUsdc);
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

    function getLicenseTokenPrice() public view returns (uint256 price) {
        uint256 priceInStablecoin = getLicensePriceInUSD() * PRICE_DECIMALS;
        uint256 r1Price = _liquidityManager.getTokenPrice();
        return (priceInStablecoin * PRICE_DECIMALS) / r1Price;
    }

    function getLicensePriceInUSD() public view returns (uint256 price) {
        return _priceTiers[currentPriceTier].usdPrice;
    }

    function _burn(
        uint256 tokenId
    ) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function setBaseURI(string memory baseURI) public onlyOwner {
        _baseTokenURI = baseURI;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        require(
            _exists(tokenId),
            "ERC721Metadata: URI query for nonexistent token"
        );
        return _baseTokenURI;
    }

    function burn(uint256 tokenId) public whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not the owner of the license");
        _burn(tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) whenNotPaused {
        License storage license = licenses[tokenId];
        require(!license.isBanned, "License is banned, cannot perform action");
        _removeNodeAddress(license, tokenId);
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Enumerable, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function setCompanyWallets(
        address newCompanyWallet,
        address newLpWallet
    ) public onlyOwner {
        companyWallet = newCompanyWallet;
        lpWallet = newLpWallet;
    }

    function setMNDContract(address mndContract_) public onlyOwner {
        _mndContract = IMND(mndContract_);
    }

    function banLicense(uint256 licenseId) public onlyOwner {
        License storage license = licenses[licenseId];
        require(!license.isBanned, "License is already banned");
        license.isBanned = true;
    }

    function unbanLicense(uint256 licenseId) public onlyOwner {
        License storage license = licenses[licenseId];
        require(license.isBanned, "License is not banned");
        license.isBanned = false;
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
            uint256 claimableEpochs = 0;

            if (
                license.nodeAddress != address(0) &&
                license.lastClaimEpoch < currentEpoch &&
                license.totalClaimedAmount <
                _controller.ND_MAX_MINING_PER_LICENSE()
            ) {
                claimableEpochs = currentEpoch - license.lastClaimEpoch;
            }

            licensesInfo[i] = LicenseInfo({
                licenseId: licenseId,
                nodeAddress: license.nodeAddress,
                totalClaimedAmount: license.totalClaimedAmount,
                remainingAmount: _controller.ND_MAX_MINING_PER_LICENSE() -
                    license.totalClaimedAmount,
                lastClaimEpoch: license.lastClaimEpoch,
                claimableEpochs: claimableEpochs,
                assignTimestamp: license.assignTimestamp,
                lastClaimOracle: license.lastClaimOracle,
                isBanned: license.isBanned
            });
        }

        return licensesInfo;
    }

    function getPriceTiers() public view returns (PriceTier[] memory) {
        PriceTier[] memory priceTiers = new PriceTier[](LAST_PRICE_TIER);
        for (uint8 i = 1; i <= LAST_PRICE_TIER; i++) {
            priceTiers[i - 1] = _priceTiers[i];
        }
        return priceTiers;
    }

    function isNodeAlreadyLinked(
        address nodeAddress
    ) public view returns (bool) {
        return
            registeredNodeAddresses[nodeAddress] ||
            _mndContract.registeredNodeAddresses(nodeAddress);
    }

    function isNodeActive(address nodeAddress) public view returns (bool) {
        if (registeredNodeAddresses[nodeAddress]) {
            License memory license = licenses[nodeToLicenseId[nodeAddress]];
            return !license.isBanned;
        }
        if (_mndContract.registeredNodeAddresses(nodeAddress)) {
            return true; // MND licenses cannot be banned
        }
        return false;
    }

    // LP setup
    function setLiquidityManager(address liquidityManager) public onlyOwner {
        _liquidityManager = ILiquidityManager(liquidityManager);
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifyRewardsSignatures(
        ComputeRewardsParams memory computeParam,
        bytes[] memory signatures
    ) internal returns (address) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                computeParam.nodeAddress,
                computeParam.epochs,
                computeParam.availabilies
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        return
            _controller.requireVerifySignatures(
                ethSignedMessageHash,
                signatures,
                true
            );
    }

    function verifyBuyLicenseSignature(
        address addr,
        bytes32 invoiceUuid,
        uint256 usdMintLimit,
        bytes memory signature
    ) internal returns (address) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(addr, invoiceUuid, usdMintLimit)
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
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
