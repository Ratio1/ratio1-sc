// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
contract AdoptionOracle is Initializable, OwnableUpgradeable {
    uint256 private constant MAX_ADOPTION_PERCENTAGE = 255;

    address public ndContract;
    address public poaiManager;

    uint256 public totalLicensesSold;
    uint256 public totalPoaiVolume;

    uint256[] private licensesSoldEpochs;
    uint256[] private licensesSoldTotals;
    uint256[] private poaiVolumeEpochs;
    uint256[] private poaiVolumeTotals;

    uint256 public ndFullReleaseThreshold;
    uint256 public poaiVolumeFullReleaseThreshold;

    event NdFullReleaseThresholdUpdated(uint256 newThreshold);
    event PoaiVolumeFullReleaseThresholdUpdated(uint256 newThreshold);

    function initialize(
        address newOwner,
        address ndContract_,
        address poaiManager_,
        uint256 ndFullReleaseThreshold_,
        uint256 poaiVolumeFullReleaseThreshold_
    ) public initializer {
        require(ndContract_ != address(0), "ND contract cannot be zero");
        require(poaiManager_ != address(0), "PoAI Manager cannot be zero");
        require(ndFullReleaseThreshold_ != 0, "ND threshold cannot be zero");
        require(
            poaiVolumeFullReleaseThreshold_ != 0,
            "PoAI threshold cannot be zero"
        );
        __Ownable_init(newOwner);
        ndContract = ndContract_;
        poaiManager = poaiManager_;
        ndFullReleaseThreshold = ndFullReleaseThreshold_;
        poaiVolumeFullReleaseThreshold = poaiVolumeFullReleaseThreshold_;
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
        uint256 newLicensesSold
    ) external onlyND {
        if (newLicensesSold == 0) {
            return;
        }
        totalLicensesSold += newLicensesSold;
        _recordLicensesSold(epoch);
    }

    function recordPoaiVolume(
        uint256 epoch,
        uint256 newPoaiVolume
    ) external onlyPoAIManager {
        if (newPoaiVolume == 0) {
            return;
        }
        totalPoaiVolume += newPoaiVolume;
        _recordPoaiVolume(epoch);
    }

    function setNdFullReleaseThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold != 0, "ND threshold cannot be zero");
        ndFullReleaseThreshold = newThreshold;
        emit NdFullReleaseThresholdUpdated(newThreshold);
    }

    function setPoaiVolumeFullReleaseThreshold(
        uint256 newThreshold
    ) external onlyOwner {
        require(newThreshold != 0, "PoAI threshold cannot be zero");
        poaiVolumeFullReleaseThreshold = newThreshold;
        emit PoaiVolumeFullReleaseThresholdUpdated(newThreshold);
    }

    function initializePoaiVolumes(
        uint256[] calldata epochs,
        uint256[] calldata totals
    ) external onlyOwner {
        require(
            poaiVolumeEpochs.length == 0 && totalPoaiVolume == 0,
            "PoAI volumes already set"
        );
        require(epochs.length == totals.length, "Length mismatch");
        for (uint256 i = 0; i < epochs.length; i++) {
            if (i > 0) {
                require(epochs[i] > epochs[i - 1], "Epochs not increasing");
                require(totals[i] >= totals[i - 1], "Totals not increasing");
            }
            poaiVolumeEpochs.push(epochs[i]);
            poaiVolumeTotals.push(totals[i]);
        }
        if (totals.length > 0) {
            totalPoaiVolume = totals[totals.length - 1];
        }
    }

    function initializeLicenseSales(
        uint256[] calldata epochs,
        uint256[] calldata totals
    ) external onlyOwner {
        require(
            licensesSoldEpochs.length == 0 && totalLicensesSold == 0,
            "License sales already set"
        );
        require(epochs.length == totals.length, "Length mismatch");
        for (uint256 i = 0; i < epochs.length; i++) {
            if (i > 0) {
                require(epochs[i] > epochs[i - 1], "Epochs not increasing");
                require(totals[i] >= totals[i - 1], "Totals not increasing");
            }
            licensesSoldEpochs.push(epochs[i]);
            licensesSoldTotals.push(totals[i]);
        }
        if (totals.length > 0) {
            totalLicensesSold = totals[totals.length - 1];
        }
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

    function getAdoptionPercentageAtEpoch(
        uint256 epoch
    ) public view returns (uint8) {
        return
            _calculateAdoptionPercentage(
                getLicensesSoldAtEpoch(epoch),
                getPoaiVolumeAtEpoch(epoch)
            );
    }

    function getAdoptionPercentagesRange(
        uint256 fromEpoch,
        uint256 toEpoch
    ) public view returns (uint8[] memory) {
        require(fromEpoch <= toEpoch, "Invalid epoch range");
        uint256 length = toEpoch - fromEpoch + 1;
        uint8[] memory percentages = new uint8[](length);

        (uint256 ndIndex, bool ndFound) = _findLicensesSoldCheckpoint(
            fromEpoch
        );
        uint256 currentNdTotal = ndFound ? licensesSoldTotals[ndIndex] : 0;
        uint256 nextNdIndex = ndFound ? ndIndex + 1 : 0;

        (uint256 poaiIndex, bool poaiFound) = _findPoaiVolumeCheckpoint(
            fromEpoch
        );
        uint256 currentPoaiTotal = poaiFound ? poaiVolumeTotals[poaiIndex] : 0;
        uint256 nextPoaiIndex = poaiFound ? poaiIndex + 1 : 0;

        for (uint256 i = 0; i < length; i++) {
            uint256 epoch = fromEpoch + i;
            while (
                nextNdIndex < licensesSoldEpochs.length &&
                licensesSoldEpochs[nextNdIndex] <= epoch
            ) {
                currentNdTotal = licensesSoldTotals[nextNdIndex];
                nextNdIndex++;
            }
            while (
                nextPoaiIndex < poaiVolumeEpochs.length &&
                poaiVolumeEpochs[nextPoaiIndex] <= epoch
            ) {
                currentPoaiTotal = poaiVolumeTotals[nextPoaiIndex];
                nextPoaiIndex++;
            }
            percentages[i] = _calculateAdoptionPercentage(
                currentNdTotal,
                currentPoaiTotal
            );
        }
        return percentages;
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

    function _calculateAdoptionPercentage(
        uint256 totalLicensesSold_,
        uint256 totalPoaiVolume_
    ) private view returns (uint8) {
        uint256 ndScore =
            (totalLicensesSold_ * MAX_ADOPTION_PERCENTAGE) /
            ndFullReleaseThreshold;
        uint256 poaiScore =
            (totalPoaiVolume_ * MAX_ADOPTION_PERCENTAGE) /
            poaiVolumeFullReleaseThreshold;
        uint256 combined = (ndScore + poaiScore) / 2;
        if (combined > MAX_ADOPTION_PERCENTAGE) {
            combined = MAX_ADOPTION_PERCENTAGE;
        }
        return uint8(combined);
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
