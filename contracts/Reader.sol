// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "./Controller.sol";
import "./R1.sol";

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
    uint256 firstMiningEpoch;
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

struct OracleDetails {
    address oracleAddress;
    uint256 signaturesCount;
    uint256 additionTimestamp;
}

struct AddressBalances {
    address addr;
    uint256 ethBalance;
    uint256 r1Balance;
}

interface IBaseDeed {
    function nodeToLicenseId(address node) external view returns (uint256);

    function ownerOf(uint256 tokenId) external view returns (address);

    function balanceOf(address owner) external view returns (uint256);

    function tokenOfOwnerByIndex(
        address owner,
        uint256 index
    ) external view returns (uint256);

    function totalSupply() external view returns (uint256);
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

contract Reader is Initializable {
    IND public ndContract;
    IMND public mndContract;
    Controller public controller;
    R1 public r1Contract;

    uint256 constant ND_LICENSE_ASSIGNED_TOKENS = 1575_188843457943924200;
    uint256 constant GENESIS_TOKEN_ID = 1;

    function initialize(
        address _ndContract,
        address _mndContract,
        address _controller,
        address _r1Contract
    ) public initializer {
        ndContract = IND(_ndContract);
        mndContract = IMND(_mndContract);
        controller = Controller(_controller);
        r1Contract = R1(_r1Contract);
    }

    function setController(address _controller) public {
        require(address(controller) == address(0), "Controller already set");
        controller = Controller(_controller);
    }

    function setR1Contract(address _r1Contract) public {
        require(address(r1Contract) == address(0), "R1 contract already set");
        r1Contract = R1(_r1Contract);
    }

    function getNdLicenseDetails(
        uint256 licenseId
    ) public view returns (LicenseDetails memory) {
        NDLicense memory ndLicense = ndContract.licenses(licenseId);
        return
            LicenseDetails(
                LicenseType.ND,
                licenseId,
                ndContract.ownerOf(licenseId),
                ndLicense.nodeAddress,
                ND_LICENSE_ASSIGNED_TOKENS,
                ndLicense.totalClaimedAmount,
                ndLicense.lastClaimEpoch,
                ndLicense.assignTimestamp,
                ndLicense.lastClaimOracle,
                ndLicense.isBanned
            );
    }

    function getMndLicenseDetails(
        uint256 licenseId
    ) public view returns (LicenseDetails memory) {
        MNDLicense memory mndLicense = mndContract.licenses(licenseId);
        return
            LicenseDetails(
                licenseId == GENESIS_TOKEN_ID
                    ? LicenseType.GND
                    : LicenseType.MND,
                licenseId,
                mndContract.ownerOf(licenseId),
                mndLicense.nodeAddress,
                mndLicense.totalAssignedAmount,
                mndLicense.totalClaimedAmount,
                mndLicense.lastClaimEpoch,
                mndLicense.assignTimestamp,
                mndLicense.lastClaimOracle,
                false
            );
    }

    function getNodeLicenseDetails(
        address node
    ) public view returns (LicenseDetails memory) {
        uint256 ndLicenseId = ndContract.nodeToLicenseId(node);
        if (ndLicenseId != 0) {
            return getNdLicenseDetails(ndLicenseId);
        }
        uint256 mndLicenseId = mndContract.nodeToLicenseId(node);
        if (mndLicenseId != 0) {
            return getMndLicenseDetails(mndLicenseId);
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

    function getUserLicenses(
        address user
    ) public view returns (LicenseDetails[] memory) {
        uint256 ndBalance = ndContract.balanceOf(user);
        uint256 mndBalance = mndContract.balanceOf(user);
        LicenseDetails[] memory licenses = new LicenseDetails[](
            ndBalance + mndBalance
        );

        for (uint256 i = 0; i < mndBalance; i++) {
            uint256 licenseId = mndContract.tokenOfOwnerByIndex(user, i);
            licenses[i] = getMndLicenseDetails(licenseId);
        }
        for (uint256 i = 0; i < ndBalance; i++) {
            uint256 licenseId = ndContract.tokenOfOwnerByIndex(user, i);
            licenses[i + mndBalance] = getNdLicenseDetails(licenseId);
        }
        return licenses;
    }

    function getLicensesTotalSupply()
        public
        view
        returns (uint256 mndSupply, uint256 ndSupply)
    {
        return (mndContract.totalSupply(), ndContract.totalSupply());
    }

    function getNodeLicenseDetailsByNode(
        address node
    )
        public
        view
        returns (uint256 licenseId, address owner, uint256 assignTimestamp)
    {
        LicenseDetails memory licenseDetails = getNodeLicenseDetails(node);
        return (
            licenseDetails.licenseId,
            licenseDetails.owner,
            licenseDetails.assignTimestamp
        );
    }

    function getWalletNodes(
        address wallet
    ) public view returns (address[] memory nodes) {
        uint256 ndBalance = ndContract.balanceOf(wallet);
        uint256 mndBalance = mndContract.balanceOf(wallet);

        nodes = new address[](ndBalance + mndBalance);
        for (uint256 i = 0; i < mndBalance; i++) {
            uint256 licenseId = mndContract.tokenOfOwnerByIndex(wallet, i);
            MNDLicense memory mndLicense = mndContract.licenses(licenseId);
            nodes[i] = mndLicense.nodeAddress;
        }
        for (uint256 i = 0; i < ndBalance; i++) {
            uint256 licenseId = ndContract.tokenOfOwnerByIndex(wallet, i);
            NDLicense memory ndLicense = ndContract.licenses(licenseId);
            nodes[i + mndBalance] = ndLicense.nodeAddress;
        }
        return nodes;
    }

    function getOraclesDetails() public view returns (OracleDetails[] memory) {
        address[] memory oracles = controller.getOracles();
        OracleDetails[] memory oracleDetails = new OracleDetails[](
            oracles.length
        );
        for (uint256 i = 0; i < oracles.length; i++) {
            address oracle = oracles[i];
            oracleDetails[i] = OracleDetails(
                oracle,
                controller.oracleSignaturesCount(oracle),
                controller.oracleAdditionTimestamp(oracle)
            );
        }
        return oracleDetails;
    }

    function getAddressesBalances(
        address[] memory addresses
    ) public view returns (AddressBalances[] memory balances) {
        balances = new AddressBalances[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            address addr = addresses[i];
            balances[i] = AddressBalances(
                addr,
                addr.balance,
                r1Contract.balanceOf(addr)
            );
        }
        return balances;
    }
}
