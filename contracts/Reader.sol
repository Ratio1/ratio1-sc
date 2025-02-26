// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

struct NDLicense {
    address nodeAddress;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
    bool isBanned;
}

struct MNDLicense {
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
}

enum LicenseType {
    None,
    ND,
    MND,
    GND
}

struct LicenseDetails {
    LicenseType licenseType;
    uint256 licenseId;
    address owner;
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
    bool isBanned;
}

interface IBaseDeed {
    function nodeToLicenseId(address node) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IND is IBaseDeed {
    function licenses(
        uint256 licenseId
    ) external view returns (NDLicense memory);
}

interface IMND is IBaseDeed {
    function licenses(
        uint256 licenseId
    ) external view returns (MNDLicense memory);
}

contract Reader {
    IND public ndContract;
    IMND public mndContract;

    uint256 constant ND_LICENSE_ASSIGNED_TOKENS = 1575_188843457943924200;
    uint256 constant GENESIS_TOKEN_ID = 1;

    constructor(address _ndContract, address _mndContract) {
        ndContract = IND(_ndContract);
        mndContract = IMND(_mndContract);
    }

    function getNodeLicenseDetails(
        address node
    ) external view returns (LicenseDetails memory) {
        uint256 ndLicenseId = ndContract.nodeToLicenseId(node);
        if (ndLicenseId != 0) {
            NDLicense memory ndLicense = ndContract.licenses(ndLicenseId);
            return
                LicenseDetails(
                    LicenseType.ND,
                    ndLicenseId,
                    ndContract.ownerOf(ndLicenseId),
                    ndLicense.nodeAddress,
                    ND_LICENSE_ASSIGNED_TOKENS,
                    ndLicense.totalClaimedAmount,
                    ndLicense.lastClaimEpoch,
                    ndLicense.assignTimestamp,
                    ndLicense.lastClaimOracle,
                    ndLicense.isBanned
                );
        }
        uint256 mndLicenseId = mndContract.nodeToLicenseId(node);
        if (mndLicenseId != 0) {
            MNDLicense memory mndLicense = mndContract.licenses(mndLicenseId);
            return
                LicenseDetails(
                    mndLicenseId == GENESIS_TOKEN_ID
                        ? LicenseType.GND
                        : LicenseType.MND,
                    mndLicenseId,
                    mndContract.ownerOf(mndLicenseId),
                    mndLicense.nodeAddress,
                    mndLicense.totalAssignedAmount,
                    mndLicense.totalClaimedAmount,
                    mndLicense.lastClaimEpoch,
                    mndLicense.assignTimestamp,
                    mndLicense.lastClaimOracle,
                    false
                );
        }
        return
            LicenseDetails(
                LicenseType.None,
                0,
                address(0),
                address(0),
                0,
                0,
                0,
                0,
                address(0),
                false
            );
    }
}
