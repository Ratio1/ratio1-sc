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
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
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

struct PriceTier {
    uint256 usdPrice; // Price in USD
    uint256 totalUnits; // Number of units available at this stage
    uint256 soldUnits; // Number of units sold at this stage
}

struct License {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    //TODO add lastClaimOracle
}

struct LicenseInfo {
    uint256 licenseId;
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 remainingAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
    uint256 assignTimestamp;
}

// TODO - Implement an upgradeability pattern for future improvements.
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
    uint256 public startEpochTimestamp = 1710028800; // 2024-03-10 00:00:00 UTC
    uint256 public epochDuration = 24 hours;

    uint256 constant MAX_PERCENTAGE = 100_00;
    uint8 constant MAX_AVAILABILITY = 255;

    uint256 constant USDC_DECIMALS = 10 ** 6;
    uint256 constant PRICE_DECIMALS = 10 ** 18;

    uint256 constant MAX_TOKEN_SUPPLY = 1618033988 * PRICE_DECIMALS;
    uint8 constant LAST_PRICE_TIER = 12;

    uint256 constant MAX_LICENSE_SUPPLY = 46224;
    uint256 constant MAX_LICENSE_TOKENS_PERCENTAGE = 40_00; // 40% of total supply
    uint256 constant MAX_LICENSE_TOKENS_SUPPLY =
        (MAX_TOKEN_SUPPLY * MAX_LICENSE_TOKENS_PERCENTAGE) / MAX_PERCENTAGE;
    uint256 constant MAX_RELEASE_PER_LICENSE =
        MAX_LICENSE_TOKENS_SUPPLY / MAX_LICENSE_SUPPLY;
    uint256 constant RELEASE_DURATION_YEARS = 5;
    uint256 constant MAX_RELEASE_PER_DAY =
        MAX_RELEASE_PER_LICENSE / RELEASE_DURATION_YEARS / 12 / 30;

    uint256 constant MAX_LICENSES_BUYS_PER_TX = 5;
    uint256 constant BURN_PERCENTAGE = 20_00;
    uint256 constant LIQUIDITY_PERCENTAGE = 50_00;
    uint256 constant COMPANY_PERCENTAGE = 30_00;
    uint256 constant LIQUIDITY_DEADLINE_EXTENSION = 20 minutes;

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

    NAEURA public _naeuraToken;
    IUniswapV2Router02 _uniswapV2Router;
    address _usdcAddr;

    address[] public signers;
    mapping(address => bool) isSigner;
    mapping(uint8 => PriceTier) public _priceTiers;
    mapping(uint256 => License) public licenses;
    mapping(address => bool) public registeredNodeAddresses;

    //.########.##.....##.########.##....##.########..######.
    //.##.......##.....##.##.......###...##....##....##....##
    //.##.......##.....##.##.......####..##....##....##......
    //.######...##.....##.######...##.##.##....##.....######.
    //.##........##...##..##.......##..####....##..........##
    //.##.........##.##...##.......##...###....##....##....##
    //.########....###....########.##....##....##.....######.

    event LicenseCreated(address indexed to, uint256 indexed tokenId);
    event RegisterNode(
        address indexed to,
        uint256 indexed licenseId,
        address nodeAddress
    );
    event RemovedNode(
        address indexed owner,
        uint256 indexed licenseId,
        address oldNodeAddress
    );
    event SignerAdded(address newSigner);
    event SignerRemoved(address removedSigner);
    event LpAddrChanged(address newlpAddr);
    event LiquidityAdded(uint256 tokenAmount, uint256 ethAmount);
    event TokenSwapFailed(uint256 tokenAmount, string reason);
    event LiquidityAdditionFailed(
        uint256 tokenAmount,
        uint256 ethAmount,
        string reason
    );

    constructor(
        address tokenAddress,
        address signerAddress
    ) ERC721("NDLicense", "ND") {
        _naeuraToken = NAEURA(tokenAddress);
        addSigner(signerAddress);

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
        _priceTiers[11] = PriceTier(10000, 10946, 0);
        _priceTiers[12] = PriceTier(20000, 17711, 0);

        uint256 ndSupply = 0;
        for (uint8 i = 1; i <= LAST_PRICE_TIER; i++) {
            ndSupply += _priceTiers[i].totalUnits;
        }
        require(ndSupply == MAX_LICENSE_SUPPLY, "Invalid license supply");

        currentPriceTier = 1;
    }

    function buyLicense(
        uint256 nLicensesToBuy,
        uint8 requestedPriceTier
    )
        public
        //TODO add KYC/KYB check
        nonReentrant
        whenNotPaused
        returns (uint)
    {
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

        PriceTier storage priceTier = _priceTiers[currentPriceTier];
        uint256 buyableUnits = getPriceTierBuyableUnits(
            priceTier,
            nLicensesToBuy
        );
        uint256 totalCost = nLicensesToBuy * getLicenseTokenPrice();

        // Check user's balance before attempting transfer
        require(
            _naeuraToken.balanceOf(msg.sender) >= totalCost,
            "Insufficient NAEURA balance"
        );
        // Check user's allowance
        require(
            _naeuraToken.allowance(msg.sender, address(this)) >= totalCost,
            "Insufficient allowance"
        );

        // Transfer NAEURA tokens from user to contract
        require(
            _naeuraToken.transferFrom(msg.sender, address(this), totalCost),
            "NAEURA transfer failed"
        );
        distributePayment(totalCost);

        uint256[] memory mintedTokens = batchMint(msg.sender, buyableUnits);

        priceTier.soldUnits += mintedTokens.length;
        if (priceTier.soldUnits == priceTier.totalUnits) {
            currentPriceTier++;
        } else if (priceTier.soldUnits > priceTier.totalUnits) {
            revert("Price tier sold more than available units");
        }

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

            licenses[tokenId] = License({
                licenseId: tokenId,
                nodeAddress: address(0),
                lastClaimEpoch: 0,
                totalClaimedAmount: 0,
                assignTimestamp: 0
            });
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
            !registeredNodeAddresses[newNodeAddress],
            "Node address already registered"
        );

        // TODO: check if nodeAddress also in MND

        License storage license = licenses[licenseId];
        require(
            license.assignTimestamp + 24 hours < block.timestamp,
            "Cannot reassign within 24 hours"
        );

        _removeNodeAddress(license);
        license.nodeAddress = newNodeAddress;
        license.lastClaimEpoch = getCurrentEpoch();
        license.assignTimestamp = block.timestamp;
        registeredNodeAddresses[newNodeAddress] = true;

        emit RegisterNode(msg.sender, licenseId, newNodeAddress);
    }

    function unlinkNode(uint256 licenseId) public whenNotPaused {
        require(
            ownerOf(licenseId) == msg.sender,
            "Not the owner of the license"
        );
        License storage license = licenses[licenseId];
        _removeNodeAddress(license);
    }

    function _removeNodeAddress(License storage license) private {
        if (license.nodeAddress == address(0)) {
            return;
        }

        // TODO: force claim rewards before removing nodeAddress
        address oldNodeAddress = license.nodeAddress;
        registeredNodeAddresses[license.nodeAddress] = false;
        license.nodeAddress = address(0);

        emit RemovedNode(msg.sender, license.licenseId, oldNodeAddress);
    }

    function claimRewards(
        ComputeRewardsParams[] memory computeParams,
        bytes[] memory signatures
    ) public nonReentrant whenNotPaused {
        require(
            computeParams.length == signatures.length,
            "Mismatched input arrays length"
        );

        uint256 totalRewards = 0;
        for (uint256 i = 0; i < computeParams.length; i++) {
            require(
                ownerOf(computeParams[i].licenseId) == msg.sender,
                "User does not have the license"
            );
            require(
                verifyRewardsSignature(computeParams[i], signatures[i]),
                "Invalid signature"
            );

            License storage license = licenses[computeParams[i].licenseId];
            uint256 rewardsAmount = calculateLicenseRewards(
                license,
                computeParams[i]
            );

            license.lastClaimEpoch = getCurrentEpoch();
            license.totalClaimedAmount += rewardsAmount;
            totalRewards += rewardsAmount;
        }

        if (totalRewards > 0) {
            _naeuraToken.mint(msg.sender, totalRewards);
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

        require( // TODO: remove this check
            license.nodeAddress == computeParam.nodeAddress,
            "Invalid node address."
        );

        uint256 epochsToClaim = currentEpoch - license.lastClaimEpoch;
        if (
            epochsToClaim <= 0 ||
            license.totalClaimedAmount == MAX_RELEASE_PER_LICENSE
        ) {
            return 0;
        }

        require(
            computeParam.epochs.length == epochsToClaim &&
                computeParam.availabilies.length == epochsToClaim,
            "Incorrect number of params."
        );

        for (uint256 i = 0; i < epochsToClaim; i++) {
            licenseRewards +=
                (MAX_RELEASE_PER_DAY * computeParam.availabilies[i]) /
                MAX_AVAILABILITY;
        }

        uint256 maxRemainingClaimAmount = MAX_RELEASE_PER_LICENSE -
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
        emit LicenseCreated(to, newTokenId);

        return newTokenId;
    }

    function distributePayment(uint256 totalCost) private {
        uint256 burnAmount = (totalCost * BURN_PERCENTAGE) / MAX_PERCENTAGE;
        uint256 liquidityAmount = (totalCost * LIQUIDITY_PERCENTAGE) /
            MAX_PERCENTAGE;
        uint256 companyAmount = (totalCost * COMPANY_PERCENTAGE) /
            MAX_PERCENTAGE;

        _naeuraToken.burn(address(this), burnAmount);
        addLiquidity(liquidityAmount);
        _naeuraToken.transfer(owner(), companyAmount); //TODO check if it should be distributed in any other way
    }

    // LP interactions
    function addLiquidity(uint256 naeuraAmount) private {
        _naeuraToken.approve(address(_uniswapV2Router), naeuraAmount);

        uint256 halfNaeuraAmount = naeuraAmount / 2;
        uint256 usdcAmount = swapTokensForUsdc(halfNaeuraAmount);

        if (usdcAmount == 0) {
            //TODO what should happen in case of a failed swap?
            emit LiquidityAdditionFailed(naeuraAmount, 0, "Token swap failed");
            return;
        }

        (uint256 usedAmountNaeura, uint256 usedAmountUsdc, ) = _uniswapV2Router
            .addLiquidity(
                address(_naeuraToken),
                _usdcAddr,
                halfNaeuraAmount,
                usdcAmount,
                0, // Min tokens out
                0, // Min USDC out
                address(this), //TODO this liquidity should die here? Or maybe be sent to the company?
                block.timestamp + LIQUIDITY_DEADLINE_EXTENSION
            );

        emit LiquidityAdded(usedAmountNaeura, usedAmountUsdc);

        uint256 remainingAmountNaeura = halfNaeuraAmount - usedAmountNaeura;
        uint256 remainingAmountUsdc = usdcAmount - usedAmountUsdc;

        //TODO is this fine?
        if (remainingAmountNaeura > 0) {
            _naeuraToken.transfer(owner(), remainingAmountNaeura);
        }
        if (remainingAmountUsdc > 0) {
            IERC20(_usdcAddr).transfer(owner(), remainingAmountUsdc);
        }
    }

    function swapTokensForUsdc(uint256 amount) private returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = address(_naeuraToken);
        path[1] = _usdcAddr;

        try
            _uniswapV2Router.swapExactTokensForTokens(
                amount, // Amount of tokens to swap
                0, // Minimum amount of tokens to receive
                path, // Path of tokens to swap
                address(this), // Address to receive the swapped tokens
                block.timestamp // Deadline
            )
        returns (uint256[] memory amounts) {
            return amounts[1];
        } catch Error(string memory reason) {
            emit TokenSwapFailed(amount, reason);
            return 0;
        } catch {
            emit TokenSwapFailed(amount, "Unknown error during token swap");
            return 0;
        }
    }

    function getCurrentEpoch() public view returns (uint256) {
        return _calculateEpoch(block.timestamp);
    }

    function _calculateEpoch(uint256 timestamp) private view returns (uint256) {
        require(
            timestamp >= startEpochTimestamp,
            "Timestamp is before the start epoch."
        );

        return (timestamp - startEpochTimestamp) / epochDuration;
    }

    function getLicenseTokenPrice() public view returns (uint256 price) {
        uint256 priceInUsdc = getLicensePriceInUSD() * USDC_DECIMALS; // Convert to 6 decimals (USDC format)
        uint256 naeuraPrice = getTokenPrice(); // Price of 1 NAEURA in USDC (6 decimals)
        return (priceInUsdc * PRICE_DECIMALS) / naeuraPrice; // Result in NAEURA (18 decimals)
    }

    function getLicensePriceInUSD() public view returns (uint256 price) {
        return _priceTiers[currentPriceTier].usdPrice;
    }

    // calculate price based on pair reserves
    function getTokenPrice() public view returns (uint256 price) {
        address[] memory path = new address[](2);
        path[0] = address(_naeuraToken);
        path[1] = _usdcAddr;

        uint256 priceTokenToUsd = _uniswapV2Router.getAmountsOut(
            10 ** 18,
            path
        )[1];

        return priceTokenToUsd;
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
        return super.tokenURI(tokenId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) whenNotPaused {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        //TODO should check if from or to == address(0) ?
        License storage license = licenses[tokenId];
        _removeNodeAddress(license);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721Enumerable, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
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
                license.lastClaimEpoch < currentEpoch &&
                license.totalClaimedAmount < MAX_RELEASE_PER_LICENSE
            ) {
                claimableEpochs = currentEpoch - license.lastClaimEpoch;
            }

            licensesInfo[i] = LicenseInfo({
                licenseId: license.licenseId,
                nodeAddress: license.nodeAddress,
                totalClaimedAmount: license.totalClaimedAmount,
                remainingAmount: MAX_RELEASE_PER_LICENSE -
                    license.totalClaimedAmount,
                lastClaimEpoch: license.lastClaimEpoch,
                claimableEpochs: claimableEpochs,
                assignTimestamp: license.assignTimestamp
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

    // LP setup
    function setUniswapRouter(address uniswapV2Router_) public onlyOwner {
        _uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
    }

    function setUsdcAddress(address usdcAddr_) public onlyOwner {
        _usdcAddr = usdcAddr_;
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
