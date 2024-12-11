// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
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

struct PriceTier {
    uint256 price; // Price in USD
    uint256 units; // Number of units available at this stage
    uint256 sold; // Number of units sold at this stage
}

struct License {
    bool exists;
    uint256 licenseId;
    string nodeHash;
    uint256 lastClaimCycle;
    uint256 currentClaimAmount;
}

struct LicenseInfo {
    uint256 licenseId;
    string nodeHash;
    uint256 lastClaimCycle;
    uint256 currentClaimAmount;
    uint256 remainingClaimAmount;
    uint256 currentClaimableCycles;
}

abstract contract IERC20Extented is IERC20 {
    function decimals() public view virtual returns (uint8);
}

// TODO - Implement an upgradeability pattern for future improvements.
contract NDContract is
    ERC721,
    ERC721Enumerable,
    ERC721URIStorage,
    Pausable,
    Ownable,
    ReentrancyGuard
{
    using SafeMath for uint256;
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    NAEURA public _token;

    uint8 public currentPriceTier;
    uint256 public startCycleTimestamp;
    address[] public signers;
    mapping(address => uint) index;
    uint256 public cycleDuration;

    IUniswapV2Router02 _uniswapV2Router;
    IUniswapV2Pair _uniswapV2Pair;
    address _usdcAddr;

    string private _baseTokenURI;

    // General constants
    uint8 private constant MAX_AVAILABILITY = 255;
    uint256 private constant USDC_DECIMALS = 10 ** 6;
    uint256 private constant PRICE_DECIMALS = 10 ** 18;
    uint256 constant MAX_TOKEN_SUPPLY = 1618033988 * PRICE_DECIMALS;
    uint256 constant MAX_PERCENT = 10000;

    // Node deed constants
    uint256 constant MAX_LICENSE_SUPPLY = 46224;
    uint256 constant MAX_LICENSE_TOKENS_PERCENT = 4000; // 40% of total supply
    uint256 constant MAX_LICENSE_TOKENS_SUPPLY =
        (MAX_TOKEN_SUPPLY * MAX_LICENSE_TOKENS_PERCENT) / MAX_PERCENT;
    uint256 constant MAX_RELEASE_PER_LICENSE =
        MAX_LICENSE_TOKENS_SUPPLY / MAX_LICENSE_SUPPLY;
    uint256 constant MAX_RELEASE_PER_DAY =
        MAX_RELEASE_PER_LICENSE / 5 / 12 / 30; // 5 years

    uint256 private constant MAX_LICENSES_BUYS_PER_TX = 5;
    uint256 private constant BURN_PERCENT = 2000;
    uint256 private constant LIQUIDITY_PERCENT = 5000;
    uint256 private constant EXPENSES_PERCENT = 3000; // 30%
    uint256 private constant LIQUIDITY_DEADLINE_EXTENSION = 20 minutes;

    mapping(uint8 => PriceTier) public _priceTiers;

    // Main mapping: address => licenseId => License
    mapping(address => mapping(uint256 => License)) public licenses;

    // Additional mapping to keep track of user licenses
    mapping(address => uint256[]) public userLicenses;

    // New mapping to store all registered node hashes
    mapping(string => bool) public registeredNodeHashes;

    event LicenseCreated(address indexed to, uint256 indexed tokenId);
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

    event SignerAdded(address newSigner);
    event SignerRemoved(address signerToRemove);
    event LpAddrChanged(address newlpAddr);
    event FeesWithdrawn(address to, uint256 amount);
    event TokensBurned(uint256 amount);
    event LiquidityAdded(uint256 tokenAmount, uint256 ethAmount);
    event TokenSwapFailed(uint256 tokenAmount, string reason);
    event LiquidityAdditionFailed(
        uint256 tokenAmount,
        uint256 ethAmount,
        string reason
    );

    constructor(
        address tokenAddress,
        address signerAddress,
        uint256 newCycleDuration
    ) ERC721("NDLicense", "ND") {
        _token = NAEURA(tokenAddress);
        index[signerAddress] = signers.length;
        signers.push(signerAddress);

        // TODO - change with start date of the protocol
        startCycleTimestamp = 1710028800; // 2024-03-10 00:00:00 UTC
        cycleDuration = newCycleDuration;

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
            ndSupply += _priceTiers[i].units;
        }
        require(ndSupply == MAX_LICENSE_SUPPLY, "Invalid license supply");

        currentPriceTier = 1;
    }

    function buyLicense(
        uint256 numberOfLicenses
        // TODO: add price tier as parameter in order to avoid buying more expensive tiers
    ) public nonReentrant returns (uint) {
        _requireNotPaused();
        require(currentPriceTier <= 12, "All licenses have been sold");

        require(
            numberOfLicenses > 0 &&
                numberOfLicenses <= MAX_LICENSES_BUYS_PER_TX,
            "Invalid number of licenses"
        );

        PriceTier memory priceTier = _priceTiers[currentPriceTier];
        uint256 availableUnits = priceTier.units.sub(priceTier.sold);

        if (availableUnits < numberOfLicenses) {
            numberOfLicenses = availableUnits;
        }

        uint256 pricePerLicense = getLicensePrice();
        uint256 totalCost = numberOfLicenses.mul(pricePerLicense);

        // Check user's balance before attempting transfer
        uint256 userBalance = _token.balanceOf(msg.sender);
        require(userBalance >= totalCost, "Insufficient NAEURA balance");

        // Check allowance
        uint256 allowance = _token.allowance(msg.sender, address(this));
        require(allowance >= totalCost, "Insufficient allowance");

        // Transfer NAEURA tokens from user to contract
        require(
            _token.transferFrom(msg.sender, address(this), totalCost),
            "Transfer failed"
        );

        handlePayment(totalCost);

        uint256 currentCycle = getCurrentCycle();
        for (uint i = 1; i <= numberOfLicenses; i++) {
            uint256 tokenId = safeMint(msg.sender);

            // TODO: reduce/refactor structure size
            // TODO: maybe batch minting

            licenses[msg.sender][tokenId] = License({
                exists: true,
                licenseId: tokenId,
                nodeHash: "",
                lastClaimCycle: currentCycle,
                currentClaimAmount: 0
            });

            userLicenses[msg.sender].push(tokenId);
        }

        priceTier.sold = priceTier.sold.add(numberOfLicenses);

        if (priceTier.sold == priceTier.units) {
            currentPriceTier++;
        } else if (priceTier.sold > priceTier.units) {
            revert("Price tier sold more than available units");
        }

        return numberOfLicenses;
    }

    function registerNode(uint256 licenseId, string memory nodeHash) public {
        _requireNotPaused();
        require(hasLicense(msg.sender, licenseId), "License does not exist");

        // Check if nodeHash already exists
        require(!registeredNodeHashes[nodeHash], "Node hash already exists");

        // TODO: check if nodeAddress also in MND

        // TODO: check if 24h from last assign

        // TODO: check if nodeAddress is already asigned then remove it

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

        // TODO: force claim rewards before removing nodeAddress

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

        // TODO: remove below loop - just use a totalRewards variable
        uint256 totalRewards = 0;
        for (uint256 i = 0; i < rewardsArray.length; i++) {
            if (!hasLicense(msg.sender, rewardsArray[i].licenseId)) {
                continue;
            }

            License storage license = licenses[msg.sender][
                rewardsArray[i].licenseId
            ];

            license.lastClaimCycle = getCurrentCycle();
            license.currentClaimAmount += rewardsArray[i].rewardsAmount;
            totalRewards += rewardsArray[i].rewardsAmount;
        }

        if (totalRewards > 0) {
            _token.mint(msg.sender, totalRewards);
        }
    }

    function estimateRewards(
        address addr, // TODO: remove this parameter
        ComputeRewardsParams[] memory paramsArray
    ) public view returns (ComputeRewardsResult[] memory) {
        ComputeRewardsResult[] memory results = new ComputeRewardsResult[](
            paramsArray.length
        );

        uint256 currentCycle = getCurrentCycle();
        for (uint256 i = 0; i < paramsArray.length; i++) {
            ComputeRewardsParams memory params = paramsArray[i];
            uint256 value = 0;

            if (!hasLicense(addr, params.licenseId)) {
                continue;
            }
            License storage license = licenses[addr][params.licenseId];
            require( // TODO: remove this check
                keccak256(abi.encodePacked(license.nodeHash)) ==
                    keccak256(abi.encodePacked(params.nodeHash)),
                "Invalid node hash."
            );

            if (
                license.lastClaimCycle < currentCycle &&
                license.currentClaimAmount < MAX_RELEASE_PER_LICENSE
            ) {
                uint256 cyclesToClaim = currentCycle.sub(
                    license.lastClaimCycle
                );
                require(
                    params.nodeAvailabilities.length == cyclesToClaim,
                    "Incorrect number of availabilites."
                );

                for (uint256 j = 0; j < cyclesToClaim; j++) {
                    value = value.add(
                        MAX_RELEASE_PER_DAY
                            .mul(params.nodeAvailabilities[j].availability)
                            .div(MAX_AVAILABILITY)
                    );
                }

                uint256 maxRemainingClaimAmount = MAX_RELEASE_PER_LICENSE.sub(
                    license.currentClaimAmount
                );
                if (value > maxRemainingClaimAmount) {
                    value = maxRemainingClaimAmount;
                }
            }

            results[i] = ComputeRewardsResult({
                licenseId: params.licenseId,
                rewardsAmount: value
            });
        }

        return results;
    }

    function withdrawFees(uint256 amount) public onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        uint256 contractBalance = _token.balanceOf(address(this));
        require(amount <= contractBalance, "Insufficient balance");

        require(_token.transfer(owner(), amount), "Transfer failed");
        emit FeesWithdrawn(owner(), amount);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function safeMint(address to) private returns (uint256) {
        _tokenIds.increment();
        uint256 newTokenId = _tokenIds.current();

        _safeMint(to, newTokenId);
        emit LicenseCreated(to, newTokenId);

        return newTokenId;
    }

    function handlePayment(uint256 totalCost) private {
        uint256 burnAmount = totalCost.mul(BURN_PERCENT).div(MAX_PERCENT);
        uint256 liquidityAmount = totalCost.mul(LIQUIDITY_PERCENT).div(
            MAX_PERCENT
        );

        // Burn 20% of _token from the contract's balance
        _token.burn(address(this), burnAmount);
        emit TokensBurned(burnAmount);

        // Add liquidity with 50% of _token
        addLiquidity(liquidityAmount);

        // The remaining 30% stays in the contract
        // TODO: last 30% should go to owner
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

    function getCurrentCycle() public view returns (uint256) {
        return _calculateCycle(block.timestamp);
    }

    function _calculateCycle(uint256 timestamp) private view returns (uint256) {
        require(
            timestamp >= startCycleTimestamp,
            "Timestamp is before the start cycle."
        );

        return timestamp.sub(startCycleTimestamp).div(cycleDuration);
    }

    function getLicensePrice() public view returns (uint256 price) {
        PriceTier memory priceTier = _priceTiers[currentPriceTier];
        uint256 priceInUsd = priceTier.price * USDC_DECIMALS; // Convert to 6 decimals (USDC format)
        uint256 naeuraPrice = getTokenPrice(); // Price of 1 NAEURA in USDC (6 decimals)
        return priceInUsd.mul(PRICE_DECIMALS).div(naeuraPrice); // Result in NAEURA (18 decimals)
    }

    function getLicensePriceInUSD() public view returns (uint256 price) {
        PriceTier memory priceTier = _priceTiers[currentPriceTier];
        return priceTier.price;
    }

    // calculate price based on pair reserves
    function getTokenPrice() public view returns (uint256 price) {
        address[] memory path = new address[](3);
        path[0] = address(_token);
        path[1] = _uniswapV2Router.WETH();
        path[2] = _usdcAddr;

        uint256 priceTokenToUsd = _uniswapV2Router.getAmountsOut(
            10 ** 18,
            path
        )[2];

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

        if (from != address(0) && to != address(0)) {
            // Transfer of existing token
            License storage license = licenses[from][tokenId];
            if (bytes(license.nodeHash).length > 0) {
                registeredNodeHashes[license.nodeHash] = false;
                license.nodeHash = "";
            }
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
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

        for (uint256 i = 0; i < _userLicenses.length; i++) {
            uint256 licenseId = _userLicenses[i];
            License storage license = licenses[addr][licenseId];
            uint256 cyclesToClaim = 0;
            uint256 currentCycle = getCurrentCycle();

            if (
                license.lastClaimCycle >= currentCycle ||
                license.currentClaimAmount >= MAX_RELEASE_PER_LICENSE
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
                remainingClaimAmount: MAX_RELEASE_PER_LICENSE -
                    license.currentClaimAmount,
                currentClaimableCycles: cyclesToClaim
            });
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
        string memory _nodeHash,
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
            index[newSigner] = signers.length;
            signers.push(newSigner);
            emit SignerAdded(newSigner);
        }
    }

    function removeSigner(address signerToRemove) public onlyOwner {
        uint index_signer = index[signerToRemove];
        if (signerToRemove != address(0) && index_signer > 0) {
            delete signers[index_signer];
            index[signerToRemove] = 0;
            emit SignerRemoved(signerToRemove);
        }
    }

    // Needed for the contract to receive ETH from LP in case of adding liquidity error
    receive() external payable {}
}
