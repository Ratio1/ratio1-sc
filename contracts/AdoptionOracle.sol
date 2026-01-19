// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract AdoptionOracle is Initializable, OwnableUpgradeable {
    uint256 public totalLicensesSold;
    uint256 public totalPoaiVolume;
    address public ndContract;
    address public poaiManager;

    uint256[] private licensesSoldEpochs;
    uint256[] private licensesSoldTotals;
    uint256[] private poaiVolumeEpochs;
    uint256[] private poaiVolumeTotals;

    function initialize(
        address newOwner,
        address ndContract_,
        address poaiManager_
    ) public initializer {
        require(ndContract_ != address(0), "ND contract cannot be zero");
        require(poaiManager_ != address(0), "PoAI Manager cannot be zero");
        __Ownable_init(newOwner);
        ndContract = ndContract_;
        poaiManager = poaiManager_;
    }

    modifier onlyND() {
        require(msg.sender == ndContract, "Not ND contract");
        _;
    }

    modifier onlyPoAIManager() {
        require(msg.sender == poaiManager, "Not PoAI Manager");
        _;
    }


    function recordLicenseSales(
        uint256 epoch,
        uint256 licensesSold
    ) external onlyND {
        if (licensesSold == 0) {
            return;
        }
        totalLicensesSold += licensesSold;
        _recordLicensesSold(epoch);
    }

    function recordPoaiVolume(
        uint256 epoch,
        uint256 volume
    ) external onlyPoAIManager {
        if (volume == 0) {
            return;
        }
        totalPoaiVolume += volume;
        _recordPoaiVolume(epoch);
    }

    function getLicensesSoldRange(
        uint256 fromEpoch,
        uint256 toEpoch
    ) public view returns (uint256[] memory) {
        require(fromEpoch <= toEpoch, "Invalid epoch range");
        uint256 length = toEpoch - fromEpoch + 1;
        uint256[] memory totals = new uint256[](length);
        if (licensesSoldEpochs.length == 0) {
            return totals;
        }

        (uint256 index, bool found) = _findLicensesSoldCheckpoint(fromEpoch);
        uint256 currentTotal = found ? licensesSoldTotals[index] : 0;
        uint256 nextIndex = found ? index + 1 : 0;

        for (uint256 i = 0; i < length; i++) {
            uint256 epoch = fromEpoch + i;
            while (
                nextIndex < licensesSoldEpochs.length &&
                licensesSoldEpochs[nextIndex] <= epoch
            ) {
                currentTotal = licensesSoldTotals[nextIndex];
                nextIndex++;
            }
            totals[i] = currentTotal;
        }
        return totals;
    }

    function getLicensesSoldAtEpoch(
        uint256 epoch
    ) public view returns (uint256) {
        if (licensesSoldEpochs.length == 0 || epoch < licensesSoldEpochs[0]) {
            return 0;
        }
        (uint256 index, bool found) = _findLicensesSoldCheckpoint(epoch);
        return found ? licensesSoldTotals[index] : 0;
    }

    function getPoaiVolumeRange(
        uint256 fromEpoch,
        uint256 toEpoch
    ) public view returns (uint256[] memory) {
        require(fromEpoch <= toEpoch, "Invalid epoch range");
        uint256 length = toEpoch - fromEpoch + 1;
        uint256[] memory totals = new uint256[](length);
        if (poaiVolumeEpochs.length == 0) {
            return totals;
        }

        (uint256 index, bool found) = _findPoaiVolumeCheckpoint(fromEpoch);
        uint256 currentTotal = found ? poaiVolumeTotals[index] : 0;
        uint256 nextIndex = found ? index + 1 : 0;

        for (uint256 i = 0; i < length; i++) {
            uint256 epoch = fromEpoch + i;
            while (
                nextIndex < poaiVolumeEpochs.length &&
                poaiVolumeEpochs[nextIndex] <= epoch
            ) {
                currentTotal = poaiVolumeTotals[nextIndex];
                nextIndex++;
            }
            totals[i] = currentTotal;
        }
        return totals;
    }

    function getPoaiVolumeAtEpoch(uint256 epoch) public view returns (uint256) {
        if (poaiVolumeEpochs.length == 0 || epoch < poaiVolumeEpochs[0]) {
            return 0;
        }
        (uint256 index, bool found) = _findPoaiVolumeCheckpoint(epoch);
        return found ? poaiVolumeTotals[index] : 0;
    }

    function _recordLicensesSold(uint256 epoch) private {
        uint256 len = licensesSoldEpochs.length;
        if (len == 0) {
            licensesSoldEpochs.push(epoch);
            licensesSoldTotals.push(totalLicensesSold);
            return;
        }
        require(licensesSoldEpochs[len - 1] <= epoch, "Invalid epoch order");
        if (licensesSoldEpochs[len - 1] < epoch) {
            licensesSoldEpochs.push(epoch);
            licensesSoldTotals.push(totalLicensesSold);
        } else {
            licensesSoldTotals[len - 1] = totalLicensesSold;
        }
    }

    function _recordPoaiVolume(uint256 epoch) private {
        uint256 len = poaiVolumeEpochs.length;
        if (len == 0) {
            poaiVolumeEpochs.push(epoch);
            poaiVolumeTotals.push(totalPoaiVolume);
            return;
        }
        require(poaiVolumeEpochs[len - 1] <= epoch, "Invalid epoch order");
        if (poaiVolumeEpochs[len - 1] < epoch) {
            poaiVolumeEpochs.push(epoch);
            poaiVolumeTotals.push(totalPoaiVolume);
        } else {
            poaiVolumeTotals[len - 1] = totalPoaiVolume;
        }
    }

    function _findLicensesSoldCheckpoint(
        uint256 epoch
    ) private view returns (uint256, bool) {
        uint256 len = licensesSoldEpochs.length;
        if (len == 0 || epoch < licensesSoldEpochs[0]) {
            return (0, false);
        }
        uint256 low = 0;
        uint256 high = len - 1;
        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            if (licensesSoldEpochs[mid] <= epoch) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return (low, true);
    }

    function _findPoaiVolumeCheckpoint(
        uint256 epoch
    ) private view returns (uint256, bool) {
        uint256 len = poaiVolumeEpochs.length;
        if (len == 0 || epoch < poaiVolumeEpochs[0]) {
            return (0, false);
        }
        uint256 low = 0;
        uint256 high = len - 1;
        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            if (poaiVolumeEpochs[mid] <= epoch) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return (low, true);
    }
}
