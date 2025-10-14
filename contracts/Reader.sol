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
    uint256 usdcPoaiRewards;
    uint256 r1PoaiRewards;
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

struct MndDetails {
    uint256 licenseId;
    address owner;
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 firstMiningEpoch;
    uint256 lastClaimEpoch;
    uint256 assignTimestamp;
    address lastClaimOracle;
    uint256 remainingAmount;
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

    function tokenByIndex(uint256 index) external view returns (uint256);
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

interface IPoAIManager {
    function getNodePoAIRewards(
        address nodeAddress
    ) external view returns (uint256 usdcRewards, uint256 r1Rewards);
}

contract Reader is Initializable {
    IND public ndContract;
    IMND public mndContract;
    Controller public controller;
    R1 public r1Contract;
    IPoAIManager public poaiManager;

    uint256 constant ND_LICENSE_ASSIGNED_TOKENS = 1575_188843457943924200;
    uint256 constant GENESIS_TOKEN_ID = 1;

    function initialize(
        address _ndContract,
        address _mndContract,
        address _controller,
        address _r1Contract,
        address _poaiManager
    ) public initializer {
        ndContract = IND(_ndContract);
        mndContract = IMND(_mndContract);
        controller = Controller(_controller);
        r1Contract = R1(_r1Contract);
        poaiManager = IPoAIManager(_poaiManager);
    }

    function setController(address _controller) public {
        require(address(controller) == address(0), "Controller already set");
        controller = Controller(_controller);
    }

    function setR1Contract(address _r1Contract) public {
        require(address(r1Contract) == address(0), "R1 contract already set");
        r1Contract = R1(_r1Contract);
    }

    function setPoAIManager(address _poaiManager) public {
        require(address(poaiManager) == address(0), "PoAI Manager already set");
        poaiManager = IPoAIManager(_poaiManager);
    }

    function getNdLicenseDetails(
        uint256 licenseId
    ) public view returns (LicenseDetails memory) {
        NDLicense memory ndLicense = ndContract.licenses(licenseId);
        // Get PoAI rewards for this node
        uint256 usdcPoaiRewards = 0;
        uint256 r1PoaiRewards = 0;
        if (ndLicense.nodeAddress != address(0)) {
            (usdcPoaiRewards, r1PoaiRewards) = poaiManager.getNodePoAIRewards(
                ndLicense.nodeAddress
            );
        }
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
                ndLicense.isBanned,
                usdcPoaiRewards,
                r1PoaiRewards
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
                false,
                0,
                0
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
                false,
                0,
                0
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

    function getAllMndsDetails()
        public
        view
        returns (MndDetails[] memory mnds)
    {
        uint256 supply = mndContract.totalSupply();
        mnds = new MndDetails[](supply);
        for (uint256 i = 0; i < supply; i++) {
            uint256 licenseId = mndContract.tokenByIndex(i);
            MNDLicense memory lic = mndContract.licenses(licenseId);
            address owner = mndContract.ownerOf(licenseId);
            mnds[i] = MndDetails({
                licenseId: licenseId,
                owner: owner,
                nodeAddress: lic.nodeAddress,
                totalAssignedAmount: lic.totalAssignedAmount,
                totalClaimedAmount: lic.totalClaimedAmount,
                firstMiningEpoch: lic.firstMiningEpoch,
                lastClaimEpoch: lic.lastClaimEpoch,
                assignTimestamp: lic.assignTimestamp,
                lastClaimOracle: lic.lastClaimOracle,
                remainingAmount: lic.totalAssignedAmount -
                    lic.totalClaimedAmount
            });
        }
        return mnds;
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

    function hasOracleNode(address user) public view returns (bool) {
        address[] memory oracles = controller.getOracles();
        // Check MND licenses assigned to user
        uint256 mndBalance = mndContract.balanceOf(user);
        for (uint256 i = 0; i < mndBalance; i++) {
            uint256 licenseId = mndContract.tokenOfOwnerByIndex(user, i);
            MNDLicense memory mndLicense = mndContract.licenses(licenseId);
            address nodeAddr = mndLicense.nodeAddress;
            if (nodeAddr != address(0) && _isOracle(nodeAddr, oracles)) {
                return true;
            }
        }
        // Check ND licenses assigned to user
        uint256 ndBalance = ndContract.balanceOf(user);
        for (uint256 i = 0; i < ndBalance; i++) {
            uint256 licenseId = ndContract.tokenOfOwnerByIndex(user, i);
            NDLicense memory ndLicense = ndContract.licenses(licenseId);
            address nodeAddr = ndLicense.nodeAddress;
            if (nodeAddr != address(0) && _isOracle(nodeAddr, oracles)) {
                return true;
            }
        }
        return false;
    }

    function _isOracle(
        address node,
        address[] memory oracles
    ) private pure returns (bool) {
        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i] == node) {
                return true;
            }
        }
        return false;
    }
}
