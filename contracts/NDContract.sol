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

    // TODO - change with start date of the protocol
    uint256 constant startEpochTimestamp = 1738767600; // Wednesday 5 February 2025 15:00:00
    uint256 constant epochDuration = 24 hours;

    uint256 constant MAX_PERCENTAGE = 100_00;
    uint8 constant MAX_AVAILABILITY = 255;

    uint256 constant PRICE_DECIMALS = 10 ** 18;

    uint256 constant MAX_TOKEN_SUPPLY = 161803398 * PRICE_DECIMALS;
    uint8 constant LAST_PRICE_TIER = 12;

    uint256 constant MAX_LICENSE_SUPPLY = 46224;
    uint256 constant MAX_LICENSE_TOKENS_PERCENTAGE = 45_00; // 45% of total supply
    uint256 constant MAX_LICENSE_TOKENS_SUPPLY =
        (MAX_TOKEN_SUPPLY * MAX_LICENSE_TOKENS_PERCENTAGE) / MAX_PERCENTAGE;
    uint256 constant MAX_MINING_PER_LICENSE =
        MAX_LICENSE_TOKENS_SUPPLY / MAX_LICENSE_SUPPLY;
    uint256 constant MINING_DURATION_EPOCHS = 36 * 30;
    uint256 constant MAX_RELEASE_PER_DAY =
        MAX_MINING_PER_LICENSE / MINING_DURATION_EPOCHS;
    uint256 constant MAX_LICENSES_BUYS_PER_TX = 5;

    uint256 constant BURN_PERCENTAGE = 20_00;
    uint256 constant LIQUIDITY_PERCENTAGE = 50_00;
    uint256 constant COMPANY_PERCENTAGE = 30_00;
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

    Counters.Counter private _supply;
    string private _baseTokenURI;
    uint8 public currentPriceTier;

    R1 public _R1Token;
    ILiquidityManager _liquidityManager;
    IMND _mndContract;
    address lpWallet;
    address expensesWallet;
    address marketingWallet;
    address grantsWallet;
    address csrWallet;

    address[] public signers;
    uint8 public minimumRequiredSignatures;
    mapping(address => bool) isSigner;
    mapping(uint8 => PriceTier) public _priceTiers;
    mapping(uint256 => License) public licenses;
    mapping(address => bool) public registeredNodeAddresses;
    mapping(address => address) public nodeToUser;
    mapping(address => uint256) public signerSignaturesCount;
    mapping(address => uint256) public signerAdditionTimestamp;
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
    event SignerAdded(address newSigner);
    event SignerRemoved(address removedSigner);
    event LpAddrChanged(address newlpAddr);
    event LiquidityAdded(uint256 tokenAmount, uint256 ethAmount);
    //TODO add event for claim rewards

    constructor(
        address tokenAddress,
        address newOwner
    ) ERC721("NDLicense", "ND") {
        _R1Token = R1(tokenAddress);
        minimumRequiredSignatures = 1;
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
        require(ndSupply == MAX_LICENSE_SUPPLY, "Invalid license supply");

        currentPriceTier = 1;
    }

    function buyLicense(
        uint256 nLicensesToBuy,
        uint8 requestedPriceTier,
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
        require(
            nLicensesToBuy > 0 && nLicensesToBuy <= MAX_LICENSES_BUYS_PER_TX,
            "Invalid number of licenses"
        );
        require(
            !usedInvoiceUUIDs[invoiceUuid],
            "Invoice UUID has already been used"
        );
        (bool validSignatures, ) = verifyBuyLicenseSignature(
            msg.sender,
            invoiceUuid,
            signature
        );
        require(validSignatures, "Invalid signature");

        usedInvoiceUUIDs[invoiceUuid] = true;

        PriceTier storage priceTier = _priceTiers[currentPriceTier];
        uint256 buyableUnits = getPriceTierBuyableUnits(
            priceTier,
            nLicensesToBuy
        );
        uint256 totalTokenCost = buyableUnits * getLicenseTokenPrice();
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
        nodeToUser[newNodeAddress] = msg.sender;

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
        nodeToUser[license.nodeAddress] = address(0);
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
            require(
                minimumRequiredSignatures <= nodesSignatures[i].length,
                "Insufficient signatures"
            );
            (
                bool validSignatures,
                address firstSigner
            ) = verifyRewardsSignatures(computeParams[i], nodesSignatures[i]);
            signerSignaturesCount[firstSigner]++;
            require(validSignatures, "Invalid signature");

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

        if (license.totalClaimedAmount == MAX_MINING_PER_LICENSE) {
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
                (MAX_RELEASE_PER_DAY * computeParam.availabilies[i]) /
                MAX_AVAILABILITY;
        }

        uint256 maxRemainingClaimAmount = MAX_MINING_PER_LICENSE -
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
        require(
            newTokenId <= MAX_LICENSE_SUPPLY,
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
        addLiquidity(liquidityAmount);
        distributeCompanyFunds(companyAmount);
    }

    function distributeCompanyFunds(uint256 amount) private {
        _R1Token.transfer(
            lpWallet,
            (amount * LP_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.transfer(
            expensesWallet,
            (amount * EXPENSES_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.transfer(
            marketingWallet,
            (amount * MARKETING_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.transfer(
            grantsWallet,
            (amount * GRANTS_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
        _R1Token.transfer(
            csrWallet,
            (amount * CSR_WALLET_PERCENTAGE) / MAX_PERCENTAGE
        );
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

    function _calculateEpoch(uint256 timestamp) private pure returns (uint256) {
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

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
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

    function setMNDContract(address mndContract_) public onlyOwner {
        _mndContract = IMND(mndContract_);
    }

    function setMinimumRequiredSignatures(
        uint8 minimumRequiredSignatures_
    ) public onlyOwner {
        minimumRequiredSignatures = minimumRequiredSignatures_;
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
                license.totalClaimedAmount < MAX_MINING_PER_LICENSE
            ) {
                claimableEpochs = currentEpoch - license.lastClaimEpoch;
            }

            licensesInfo[i] = LicenseInfo({
                licenseId: licenseId,
                nodeAddress: license.nodeAddress,
                totalClaimedAmount: license.totalClaimedAmount,
                remainingAmount: MAX_MINING_PER_LICENSE -
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

    // LP setup
    function setLiquidityManager(address liquidityManager) public onlyOwner {
        _liquidityManager = ILiquidityManager(liquidityManager);
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifySignatures(
        bytes32 ethSignedMessageHash,
        bytes[] memory signatures
    ) internal view returns (bool, address) {
        address[] memory seenSigners = new address[](signatures.length);
        for (uint i = 0; i < signatures.length; i++) {
            address signerAddress = ethSignedMessageHash.recover(signatures[i]);
            if (!isSigner[signerAddress]) {
                return (false, address(0));
            }
            for (uint j = 0; j < seenSigners.length; j++) {
                if (seenSigners[j] == signerAddress) {
                    return (false, address(0));
                }
            }
            seenSigners[i] = signerAddress;
        }
        return (true, seenSigners[0]);
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

    function verifyBuyLicenseSignature(
        address addr,
        bytes32 invoiceUuid,
        bytes memory signature
    ) public view returns (bool, address) {
        bytes32 messageHash = keccak256(abi.encodePacked(addr, invoiceUuid));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = signature;
        return verifySignatures(ethSignedMessageHash, signatures);
    }

    function addSigner(address newSigner) public onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        require(!isSigner[newSigner], "Signer already exists");
        isSigner[newSigner] = true;
        signerSignaturesCount[newSigner] = 0;
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
