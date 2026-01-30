// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBurnContract {
    function burn(uint256 amount) external;
}

contract BurnHub is Initializable, ReentrancyGuardUpgradeable {
    uint256 public constant TOP_BURNERS = 20;
    uint256 public constant TOP_APPS = 50;
    uint256 public constant MAX_SLUG_LENGTH = 32;

    struct App {
        string name;
        string slug;
        bool exists;
    }

    IERC20 public r1Token;
    IBurnContract public burnerContract;

    mapping(bytes32 => App) private apps;
    bytes32[] private appIds;

    mapping(address => uint256) private totalBurnedByUser;
    mapping(bytes32 => uint256) private totalBurnedByApp;
    mapping(address => bool) private hasBurned;
    uint256 private uniqueBurnersCount;

    address[TOP_BURNERS] private topBurners;
    uint256[TOP_BURNERS] private topBurnerTotals;
    uint256 private topBurnersCount;

    bytes32[TOP_APPS] private topApps;
    uint256[TOP_APPS] private topAppTotals;
    uint256 private topAppsCount;

    error AppNotRegistered();
    error AppAlreadyExists();
    error InvalidSlug();
    error InvalidAmount();
    error InvalidAddress();
    error R1TransferFailed();

    event AppRegistered(
        bytes32 indexed appId,
        string name,
        string slug,
        address indexed creator
    );
    event BurnRecorded(
        address indexed user,
        bytes32 indexed appId,
        uint256 amount,
        uint256 userTotal,
        uint256 appTotal
    );

    function initialize(
        address r1Token_,
        address burnerContract_
    ) public initializer {
        if (r1Token_ == address(0) || burnerContract_ == address(0)) {
            revert InvalidAddress();
        }
        __ReentrancyGuard_init();
        r1Token = IERC20(r1Token_);
        burnerContract = IBurnContract(burnerContract_);
    }

    function registerApp(
        string calldata name,
        string calldata slug
    ) external returns (bytes32) {
        uint256 slugLength = bytes(slug).length;
        if (slugLength == 0 || slugLength > MAX_SLUG_LENGTH) {
            revert InvalidSlug();
        }
        bytes32 appId = keccak256(bytes(slug));
        if (apps[appId].exists) {
            revert AppAlreadyExists();
        }
        apps[appId] = App({name: name, slug: slug, exists: true});
        appIds.push(appId);
        emit AppRegistered(appId, name, slug, msg.sender);
        return appId;
    }

    function burn(uint256 amount, bytes32 appId) external nonReentrant {
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (!apps[appId].exists) {
            revert AppNotRegistered();
        }

        bool success = r1Token.transferFrom(
            msg.sender,
            address(this),
            amount
        );
        if (!success) {
            revert R1TransferFailed();
        }

        burnerContract.burn(amount);

        uint256 userTotal = totalBurnedByUser[msg.sender] + amount;
        totalBurnedByUser[msg.sender] = userTotal;

        uint256 appTotal = totalBurnedByApp[appId] + amount;
        totalBurnedByApp[appId] = appTotal;

        if (!hasBurned[msg.sender]) {
            hasBurned[msg.sender] = true;
            uniqueBurnersCount += 1;
        }

        _updateTopBurners(msg.sender, userTotal);
        _updateTopApps(appId, appTotal);

        emit BurnRecorded(msg.sender, appId, amount, userTotal, appTotal);
    }

    function getApp(
        bytes32 appId
    ) external view returns (string memory name, string memory slug, bool exists) {
        App storage app = apps[appId];
        return (app.name, app.slug, app.exists);
    }

    function getAppCount() external view returns (uint256) {
        return appIds.length;
    }

    function getAppIdAt(uint256 index) external view returns (bytes32) {
        return appIds[index];
    }

    function getUserTotal(address user) external view returns (uint256) {
        return totalBurnedByUser[user];
    }

    function getAppTotal(bytes32 appId) external view returns (uint256) {
        return totalBurnedByApp[appId];
    }

    function getUniqueBurnersCount() external view returns (uint256) {
        return uniqueBurnersCount;
    }

    function getTopBurners()
        external
        view
        returns (
            address[TOP_BURNERS] memory users,
            uint256[TOP_BURNERS] memory totals
        )
    {
        return (topBurners, topBurnerTotals);
    }

    function getTopApps()
        external
        view
        returns (
            bytes32[TOP_APPS] memory ids,
            uint256[TOP_APPS] memory totals
        )
    {
        return (topApps, topAppTotals);
    }

    function _updateTopBurners(address user, uint256 total) internal {
        uint256 count = topBurnersCount;
        for (uint256 i = 0; i < count; i++) {
            if (topBurners[i] == user) {
                topBurnerTotals[i] = total;
                _bubbleUpBurners(i);
                return;
            }
        }

        if (count < TOP_BURNERS) {
            topBurners[count] = user;
            topBurnerTotals[count] = total;
            topBurnersCount = count + 1;
            _bubbleUpBurners(count);
            return;
        }

        if (total <= topBurnerTotals[TOP_BURNERS - 1]) {
            return;
        }

        topBurners[TOP_BURNERS - 1] = user;
        topBurnerTotals[TOP_BURNERS - 1] = total;
        _bubbleUpBurners(TOP_BURNERS - 1);
    }

    function _bubbleUpBurners(uint256 index) internal {
        while (index > 0) {
            uint256 prev = index - 1;
            if (topBurnerTotals[index] <= topBurnerTotals[prev]) {
                break;
            }
            _swapBurners(index, prev);
            index = prev;
        }
    }

    function _swapBurners(uint256 i, uint256 j) internal {
        (topBurners[i], topBurners[j]) = (topBurners[j], topBurners[i]);
        (topBurnerTotals[i], topBurnerTotals[j]) = (
            topBurnerTotals[j],
            topBurnerTotals[i]
        );
    }

    function _updateTopApps(bytes32 appId, uint256 total) internal {
        uint256 count = topAppsCount;
        for (uint256 i = 0; i < count; i++) {
            if (topApps[i] == appId) {
                topAppTotals[i] = total;
                _bubbleUpApps(i);
                return;
            }
        }

        if (count < TOP_APPS) {
            topApps[count] = appId;
            topAppTotals[count] = total;
            topAppsCount = count + 1;
            _bubbleUpApps(count);
            return;
        }

        if (total <= topAppTotals[TOP_APPS - 1]) {
            return;
        }

        topApps[TOP_APPS - 1] = appId;
        topAppTotals[TOP_APPS - 1] = total;
        _bubbleUpApps(TOP_APPS - 1);
    }

    function _bubbleUpApps(uint256 index) internal {
        while (index > 0) {
            uint256 prev = index - 1;
            if (topAppTotals[index] <= topAppTotals[prev]) {
                break;
            }
            _swapApps(index, prev);
            index = prev;
        }
    }

    function _swapApps(uint256 i, uint256 j) internal {
        (topApps[i], topApps[j]) = (topApps[j], topApps[i]);
        (topAppTotals[i], topAppTotals[j]) = (
            topAppTotals[j],
            topAppTotals[i]
        );
    }
}
