// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./NAEURA.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

struct NodeAvailability {
    uint256 epoch;
    uint8 availability;
}

struct ComputeRewardsParams {
    uint256 licenseId;
    address nodeAddress;
    NodeAvailability[] availabilityRecords;
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
    uint256 remainingClaimableAmount;
    uint256 lastClaimEpoch;
    uint256 claimableEpochs;
}

// TODO - Implement an upgradeability pattern for future improvements.
contract NDContract is
    ERC721,
    ERC721URIStorage,
    Pausable,
    Ownable,
    ReentrancyGuard
{
    using SafeMath for uint256;
    using Counters for Counters.Counter;

    Counters.Counter private _supply;

    NAEURA public _token;

    uint8 public currentPriceTier;
    // TODO - change with start date of the protocol
    uint256 public startEpochTimestamp = 1710028800; // 2024-03-10 00:00:00 UTC
    address[] public signers;
    uint256 public epochDuration = 24 hours;

    IUniswapV2Router02 _uniswapV2Router;
    IUniswapV2Pair _uniswapV2Pair;
    address _usdcAddr;

    string private _baseTokenURI;

    // General constants
    uint8 private constant MAX_AVAILABILITY = 255;
    uint256 private constant USDC_DECIMALS = 10 ** 6;
    uint256 private constant PRICE_DECIMALS = 10 ** 18;
    uint256 constant MAX_TOKEN_SUPPLY = 1618033988 * PRICE_DECIMALS;
    uint256 constant MAX_PERCENTAGE = 100_00;

    // Node deed constants
    uint256 constant MAX_LICENSE_SUPPLY = 46224;
    uint256 constant MAX_LICENSE_TOKENS_PERCENTAGE = 40_00; // 40% of total supply
    uint256 constant MAX_LICENSE_TOKENS_SUPPLY =
        (MAX_TOKEN_SUPPLY * MAX_LICENSE_TOKENS_PERCENTAGE) / MAX_PERCENTAGE;
    uint256 constant MAX_RELEASE_PER_LICENSE =
        MAX_LICENSE_TOKENS_SUPPLY / MAX_LICENSE_SUPPLY;
    uint256 constant RELEASE_DURATION_YEARS = 5;
    uint256 constant MAX_RELEASE_PER_DAY =
        MAX_RELEASE_PER_LICENSE / RELEASE_DURATION_YEARS / 12 / 30;

    uint256 private constant MAX_LICENSES_BUYS_PER_TX = 5;
    uint256 private constant BURN_PERCENTAGE = 20_00;
    uint256 private constant LIQUIDITY_PERCENTAGE = 50_00;
    uint256 private constant COMPANY_PERCENTAGE = 30_00;
    uint256 private constant LIQUIDITY_DEADLINE_EXTENSION = 20 minutes;

    mapping(uint8 => PriceTier) public _priceTiers;

    // Main mapping: address => licenseId => License
    mapping(address => mapping(uint256 => License)) public licenses;

    // Additional mapping to keep track of user licenses
    mapping(address => uint256[]) public userLicenses;

    // New mapping to store all registered node hashes
    mapping(address => bool) public registeredNodeAddresses; //TODO might make sense to map to the owner or licenseId?

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
        _token = NAEURA(tokenAddress);
        signers.push(signerAddress);

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
        for (uint8 i = 1; i <= 12; i++) {
            ndSupply += _priceTiers[i].totalUnits;
        }
        require(ndSupply == MAX_LICENSE_SUPPLY, "Invalid license supply");

        currentPriceTier = 1;
    }

    function buyLicense(
        uint256 nLicensesToBuy,
        uint8 requestedPriceTier
    ) public nonReentrant whenNotPaused returns (uint) {
        require(currentPriceTier <= 12, "All licenses have been sold");
        require(requestedPriceTier == currentPriceTier, "Not in the right price tier");
        require(
            nLicensesToBuy > 0 &&
                nLicensesToBuy <= MAX_LICENSES_BUYS_PER_TX,
            "Invalid number of licenses"
        );

        PriceTier storage priceTier = _priceTiers[currentPriceTier];
        uint256 availableUnits = getPriceTierAvailableUnits(priceTier, nLicensesToBuy);
        uint256 tokenPricePerLicense = getLicenseTokenPrice();
        uint256 totalCost = nLicensesToBuy * tokenPricePerLicense;

        // Check user's balance before attempting transfer
        require(_token.balanceOf(msg.sender) >= totalCost, "Insufficient NAEURA balance");
        // Check allowance
        require(_token.allowance(msg.sender, address(this)) >= totalCost, "Insufficient allowance");

        // Transfer NAEURA tokens from user to contract
        require(
            _token.transferFrom(msg.sender, address(this), totalCost),
            "NAEURA transfer failed"
        );

        distributePayment(totalCost);

        uint256[] memory mintedTokens = batchMint(msg.sender, availableUnits);

        priceTier.soldUnits += mintedTokens.length;
        if (priceTier.soldUnits == priceTier.totalUnits) {
            currentPriceTier++;
        } else if (priceTier.soldUnits > priceTier.totalUnits) {
            revert("Price tier sold more than available units");
        }

        return mintedTokens.length;
    }

    function getPriceTierAvailableUnits(PriceTier memory tier, uint256 requestedUnits) private pure returns (uint256) {
        uint256 availableUnits = tier.totalUnits - tier.soldUnits;
        return availableUnits >= requestedUnits ? requestedUnits : availableUnits;
    }

    function batchMint(address to, uint256 quantity) private returns (uint256[] memory) {
        uint256 currentEpoch = getCurrentEpoch();
        uint256[] memory tokenIds = new uint256[](quantity);

        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = safeMint(to);
            tokenIds[i] = tokenId;

            licenses[to][tokenId] = License({
                licenseId: tokenId,
                nodeAddress: address(0),
                lastClaimEpoch: currentEpoch,
                totalClaimedAmount: 0,
                assignTimestamp: 0
            });
            userLicenses[to].push(tokenId);
        }

        return tokenIds;
    }

    function registerNode(uint256 licenseId, address newNodeAddress) public whenNotPaused {
        require(hasLicense(msg.sender, licenseId), "License does not exist");
        require(newNodeAddress != address(0), "Invalid node address");
        require(!registeredNodeAddresses[newNodeAddress], "Node hash already exists");

        // TODO: check if nodeAddress also in MND

        License storage license = licenses[msg.sender][licenseId];

        require(license.nodeAddress != newNodeAddress, "Cannot reassign the same node address");
        require(license.assignTimestamp + 24 hours < block.timestamp, "Cannot reassign within 24 hours");

        _removeNodeAddress(license);
        license.nodeAddress = newNodeAddress;
        license.lastClaimEpoch = getCurrentEpoch();
        license.assignTimestamp = block.timestamp;
        registeredNodeAddresses[newNodeAddress] = true;

        emit RegisterNode(msg.sender, licenseId, newNodeAddress);
    }

    function removeNodeHash(uint256 licenseId) public whenNotPaused {
        require(hasLicense(msg.sender, licenseId), "License does not exist");
        License storage license = licenses[msg.sender][licenseId];
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
                verifySignature(
                    msg.sender,
                    computeParams[i].licenseId,
                    computeParams[i].nodeAddress,
                    computeParams[i].availabilityRecords,
                    signatures[i]
                ),
                "Invalid signature"
            );
            require(
                hasLicense(msg.sender, computeParams[i].licenseId),
                "User does not have the license"
            );

            License storage license = licenses[msg.sender][
                computeParams[i].licenseId
            ];
            uint256 rewardsAmount = calculateLicenseRewards(
                license,
                computeParams[i]
            );

            license.lastClaimEpoch = getCurrentEpoch();
            license.totalClaimedAmount += rewardsAmount;
            totalRewards += rewardsAmount;
        }

        if (totalRewards > 0) {
            _token.mint(msg.sender, totalRewards);
        }
    }

    function calculateRewards(
        address addr, // TODO: remove this parameter
        ComputeRewardsParams[] memory computeParams
    ) public view returns (ComputeRewardsResult[] memory) {
        ComputeRewardsResult[] memory results = new ComputeRewardsResult[](
            computeParams.length
        );

        for (uint256 i = 0; i < computeParams.length; i++) {
            ComputeRewardsParams memory params = computeParams[i];
            License memory license = licenses[addr][params.licenseId];
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
            computeParam.availabilityRecords.length == epochsToClaim,
            "Incorrect number of availabilites."
        );

        for (uint256 j = 0; j < epochsToClaim; j++) {
            licenseRewards += MAX_RELEASE_PER_DAY * computeParam.availabilityRecords[j].availability
                    / MAX_AVAILABILITY;
        }

        uint256 maxRemainingClaimAmount = MAX_RELEASE_PER_LICENSE - license.totalClaimedAmount;
        if (licenseRewards > maxRemainingClaimAmount) {
            licenseRewards = maxRemainingClaimAmount;
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
            "Maximum token supply reached"
        );

        _safeMint(to, newTokenId);
        emit LicenseCreated(to, newTokenId);

        return newTokenId;
    }

    function distributePayment(uint256 totalCost) private {
        uint256 burnAmount = totalCost * BURN_PERCENTAGE / MAX_PERCENTAGE;
        uint256 liquidityAmount = totalCost * LIQUIDITY_PERCENTAGE / MAX_PERCENTAGE;
        uint256 companyAmount = totalCost * COMPANY_PERCENTAGE / MAX_PERCENTAGE;

        // Burn 20% of _token from the contract's balance
        _token.burn(address(this), burnAmount);
        // Add liquidity with 50% of _token
        addLiquidity(liquidityAmount);
        // Send 30% to the company
        _token.transfer(owner(), companyAmount); //TODO check if it should be distributed in any other way
    }

    // LP interactions
    function addLiquidity(uint256 tokenAmount) private {
        _token.approve(address(_uniswapV2Router), tokenAmount);

        uint256 halfTokenAmount = tokenAmount.div(2);
        uint256 ethAmount = swapTokensForETH(halfTokenAmount);

        if (ethAmount == 0) {
            emit LiquidityAdditionFailed(tokenAmount, 0, "Token swap failed");
            return;
        }

        (bool success, bytes memory result) = address(_uniswapV2Router).call{
            value: ethAmount
        }(
            abi.encodeWithSelector(
                _uniswapV2Router.addLiquidityETH.selector,
                address(_token),
                halfTokenAmount,
                0, // Accept any amount of tokens
                0, // Accept any amount of ETH
                address(this),
                block.timestamp + LIQUIDITY_DEADLINE_EXTENSION
            )
        );

        if (success) {
            (uint256 amountToken, uint256 amountETH, ) = abi.decode(
                result,
                (uint256, uint256, uint256)
            );
            emit LiquidityAdded(amountToken, amountETH);
        } else {
            emit LiquidityAdditionFailed(
                halfTokenAmount,
                ethAmount,
                "Liquidity addition failed"
            );
            // Attempt to rescue the swapped ETH
            (bool rescueSuccess, ) = payable(owner()).call{value: ethAmount}(
                ""
            );
            require(rescueSuccess, "ETH rescue failed");
        }
    }

    function swapTokensForETH(uint256 amount) private returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = address(_token);
        path[1] = _uniswapV2Router.WETH();

        try
            _uniswapV2Router.swapExactTokensForETH(
                amount,
                0,
                path,
                address(this),
                block.timestamp
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
        PriceTier memory priceTier = _priceTiers[currentPriceTier];
        uint256 priceInUsd = priceTier.usdPrice * USDC_DECIMALS; // Convert to 6 decimals (USDC format)
        uint256 naeuraPrice = getTokenPrice(); // Price of 1 NAEURA in USDC (6 decimals)
        return priceInUsd.mul(PRICE_DECIMALS).div(naeuraPrice); // Result in NAEURA (18 decimals)
    }

    function getLicensePriceInUSD() public view returns (uint256 price) {
        PriceTier memory priceTier = _priceTiers[currentPriceTier];
        return priceTier.usdPrice;
    }

    // calculate price based on pair reserves
    function getTokenPrice() public view returns (uint256 price) {
        address[] memory path = new address[](2);
        path[0] = address(_token);
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
    ) internal override(ERC721) whenNotPaused {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        //TODO license does not get transferred
        if (from != address(0) && to != address(0)) {
            // Transfer of existing token
            License storage license = licenses[from][tokenId];
            if (license.nodeAddress != address(0)) {
                registeredNodeAddresses[license.nodeAddress] = false;
                license.nodeAddress = address(0);
            }
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    ///// View functions
    function hasLicense(
        address addr,
        uint256 licenseId
    ) public view returns (bool) {
        return licenses[addr][licenseId].licenseId != 0;
    }

    function getLicenses(
        address addr
    ) public view returns (LicenseInfo[] memory) {
        uint256[] memory _userLicenses = userLicenses[addr];
        LicenseInfo[] memory licenseInfos = new LicenseInfo[](
            _userLicenses.length
        );

        for (uint256 i = 0; i < _userLicenses.length; i++) {
            uint256 licenseId = _userLicenses[i];
            License storage license = licenses[addr][licenseId];
            uint256 epochsToClaim = 0;
            uint256 currentEpoch = getCurrentEpoch();

            if (
                license.lastClaimEpoch >= currentEpoch ||
                license.totalClaimedAmount >= MAX_RELEASE_PER_LICENSE
            ) {
                epochsToClaim = 0;
            } else {
                epochsToClaim = currentEpoch - license.lastClaimEpoch;
            }

            /*
            TODO
            licenseInfos[i] = LicenseInfo({
                licenseId: license.licenseId,
                nodeAddress: license.nodeAddress,
                lastClaimEpoch: license.lastClaimEpoch,
                currentClaimAmount: license.totalClaimedAmount,
                remainingClaimableAmount: MAX_RELEASE_PER_LICENSE -
                    license.totalClaimedAmount,
                claimableEpochs: cyclesToClaim
            });
            */
        }

        return licenseInfos;
    }

    // LP setup
    function setUniswapRouter(address uniswapV2Router_) public onlyOwner {
        _uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
    }

    function setUniswapPair(address uniswapV2Pair_) public onlyOwner {
        _uniswapV2Pair = IUniswapV2Pair(uniswapV2Pair_);
    }

    function set_usdcAddress(address usdcAddr_) public onlyOwner {
        _usdcAddr = usdcAddr_;
    }

    ///// Signature functions
    using ECDSA for bytes32;

    function verifySignature(
        address _to,
        uint256 _licenseId,
        address _nodeHash,
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

        bool verified = false;
        // TODO: 
        // mapping(address => bool) signers;
        // require(signers[receivedSigner], "Invalid signer");
        // require(ethSignedMessageHash.recover(signature) == receivedSigner)
        for (uint i = 0; i < signers.length; i++) {
            address signer = signers[i];
            if (ethSignedMessageHash.recover(signature) == signer) {
                verified = true;
                break;
            }
        }

        return verified;
    }

    function getMessageHash(
        address _to,
        uint256 _licenseId,
        address _nodeHash,
        NodeAvailability[] memory _nodeAvailabilities
    ) public pure returns (bytes32) {
        bytes memory encoded;
        // TODO: Corrent to simple keccak256(abi.encodePacked(node, epochs, epochs_vals));
        for (uint i = 0; i < _nodeAvailabilities.length; i++) {
            encoded = abi.encodePacked(
                encoded,
                _nodeAvailabilities[i].epoch,
                _nodeAvailabilities[i].availability
            );
        }
        return keccak256(abi.encodePacked(_to, _licenseId, _nodeHash, encoded));
    }

    function addSigner(address newSigner) public onlyOwner {
        if (newSigner != address(0)) {
            //index[newSigner] = signers.length;
            signers.push(newSigner);
            emit SignerAdded(newSigner);
        }
    }

    function removeSigner(address signerToRemove) public onlyOwner {
        /*
        uint index_signer = index[signerToRemove];
        if (signerToRemove != address(0) && index_signer > 0) {
            delete signers[index_signer];
            index[signerToRemove] = 0;
            emit SignerRemoved(signerToRemove);
        }
        */
    }

    // Needed for the contract to receive ETH from LP in case of adding liquidity error
    receive() external payable {}
}
