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

struct LicenseListItem {
    LicenseType licenseType;
    uint256 licenseId;
    address owner;
    address nodeAddress;
    uint256 totalAssignedAmount;
    uint256 totalClaimedAmount;
    uint256 assignTimestamp;
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

struct NdNodeOwner {
    address nodeAddress;
    address owner;
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

struct CspWithOwner {
    address cspAddress;
    address cspOwner;
}

struct JobWithAllDetails {
    uint256 id;
    bytes32 projectHash;
    uint256 requestTimestamp;
    uint256 startTimestamp;
    uint256 lastNodesChangeTimestamp;
    uint256 jobType;
    uint256 pricePerEpoch;
    uint256 lastExecutionEpoch;
    uint256 numberOfNodesRequested;
    int256 balance;
    uint256 lastAllocatedEpoch;
    address[] activeNodes;
    address escrowAddress;
    address escrowOwner;
}

struct EscrowDetails {
    address escrowAddress;
    address owner;
    int256 tvl;
    uint256 activeJobsCount;
}

struct UserEscrowDetails {
    bool isActive;
    address escrowAddress;
    address escrowOwner;
    uint256 permissions;
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
    function getNodeOwner(address nodeAddress) external view returns (address);
    function isNodeAlreadyLinked(address nodeAddress) external view returns (bool);
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
    function getAllCspsWithOwner()
        external
        view
        returns (CspWithOwner[] memory);
    function getAllActiveJobs()
        external
        view
        returns (JobWithAllDetails[] memory);
    function getCurrentEpoch() external view returns (uint256);
    function ownerToEscrow(address owner) external view returns (address);
    function escrowToOwner(address escrow) external view returns (address);
    function getAddressRegistration(
        address account
    ) external view returns (bool isActive, address escrowAddress);
}

interface ICspEscrow {
    function getTotalJobsBalance() external view returns (int256);
    function getActiveJobsCount() external view returns (uint256);
    function getDelegatePermissions(
        address delegate
    ) external view returns (uint256);
}

contract Reader is Initializable {
    IND public ndContract;
    IMND public mndContract;
    Controller public controller;
    R1 public r1Contract;
    IPoAIManager public poaiManager;

    uint256 constant ND_LICENSE_ASSIGNED_TOKENS = 1575_188843457943924200;
    uint256 constant GENESIS_TOKEN_ID = 1;
    uint256 constant ESCROW_OWNER_PERMISSIONS = type(uint256).max;

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

    function getLicensesPage(
        uint256 offset,
        uint256 limit
    )
        public
        view
        returns (
            uint256 mndSupply,
            uint256 ndSupply,
            LicenseListItem[] memory licenses
        )
    {
        mndSupply = mndContract.totalSupply();
        ndSupply = ndContract.totalSupply();
        uint256 totalSupply = mndSupply + ndSupply;

        if (offset >= totalSupply || limit == 0) {
            return (mndSupply, ndSupply, new LicenseListItem[](0));
        }

        uint256 endExclusive = offset + limit;
        if (endExclusive > totalSupply) {
            endExclusive = totalSupply;
        }

        uint256 pageSize = endExclusive - offset;
        licenses = new LicenseListItem[](pageSize);

        for (uint256 i = 0; i < pageSize; i++) {
            uint256 globalIndex = offset + i;
            if (globalIndex < mndSupply) {
                uint256 mndLicenseId = mndContract.tokenByIndex(globalIndex);
                MNDLicense memory mndLicense = mndContract.licenses(
                    mndLicenseId
                );
                licenses[i] = LicenseListItem({
                    licenseType: mndLicenseId == GENESIS_TOKEN_ID
                        ? LicenseType.GND
                        : LicenseType.MND,
                    licenseId: mndLicenseId,
                    owner: mndContract.ownerOf(mndLicenseId),
                    nodeAddress: mndLicense.nodeAddress,
                    totalAssignedAmount: mndLicense.totalAssignedAmount,
                    totalClaimedAmount: mndLicense.totalClaimedAmount,
                    assignTimestamp: mndLicense.assignTimestamp,
                    isBanned: false
                });
            } else {
                uint256 ndIndex = globalIndex - mndSupply;
                uint256 ndLicenseId = ndContract.tokenByIndex(ndIndex);
                NDLicense memory ndLicense = ndContract.licenses(ndLicenseId);
                licenses[i] = LicenseListItem({
                    licenseType: LicenseType.ND,
                    licenseId: ndLicenseId,
                    owner: ndContract.ownerOf(ndLicenseId),
                    nodeAddress: ndLicense.nodeAddress,
                    totalAssignedAmount: ND_LICENSE_ASSIGNED_TOKENS,
                    totalClaimedAmount: ndLicense.totalClaimedAmount,
                    assignTimestamp: ndLicense.assignTimestamp,
                    isBanned: ndLicense.isBanned
                });
            }
        }

        return (mndSupply, ndSupply, licenses);
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

    function getAllEscrowsDetails()
        external
        view
        returns (EscrowDetails[] memory)
    {
        CspWithOwner[] memory cspsWithOwner = poaiManager.getAllCspsWithOwner();
        EscrowDetails[] memory details = new EscrowDetails[](
            cspsWithOwner.length
        );
        for (uint256 i = 0; i < cspsWithOwner.length; i++) {
            address escrowAddr = cspsWithOwner[i].cspAddress;
            details[i] = EscrowDetails({
                escrowAddress: escrowAddr,
                owner: cspsWithOwner[i].cspOwner,
                tvl: ICspEscrow(escrowAddr).getTotalJobsBalance(),
                activeJobsCount: ICspEscrow(escrowAddr).getActiveJobsCount()
            });
        }
        return details;
    }

    function getJobsByLastExecutionEpochDelta(
        uint256 epochDelta
    ) external view returns (JobWithAllDetails[] memory) {
        JobWithAllDetails[] memory jobs = poaiManager.getAllActiveJobs();
        uint256 currentEpoch = poaiManager.getCurrentEpoch();
        uint256 count = 0;

        for (uint256 i = 0; i < jobs.length; i++) {
            uint256 lastExecutionEpoch = jobs[i].lastExecutionEpoch;
            if (
                lastExecutionEpoch <= currentEpoch &&
                currentEpoch - lastExecutionEpoch == epochDelta
            ) {
                count++;
            }
        }

        JobWithAllDetails[] memory filtered = new JobWithAllDetails[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < jobs.length; i++) {
            uint256 lastExecutionEpoch = jobs[i].lastExecutionEpoch;
            if (
                lastExecutionEpoch <= currentEpoch &&
                currentEpoch - lastExecutionEpoch == epochDelta
            ) {
                filtered[index] = jobs[i];
                index++;
            }
        }

        return filtered;
    }

    function getNdNodesOwners(
        address[] memory nodeAddresses
    ) public view returns (NdNodeOwner[] memory nodesOwners) {
        nodesOwners = new NdNodeOwner[](nodeAddresses.length);
        for (uint256 i = 0; i < nodeAddresses.length; i++) {
            address nodeAddr = nodeAddresses[i];
            address owner = address(0);
            if (ndContract.nodeToLicenseId(nodeAddr) != 0) {
                owner = ndContract.getNodeOwner(nodeAddr);
            }
            nodesOwners[i] = NdNodeOwner({nodeAddress: nodeAddr, owner: owner});
        }
        return nodesOwners;
    }

    function isMultiNodeAlreadyLinked(
        address[] memory nodeAddresses
    ) public view returns (bool[] memory linked) {
        linked = new bool[](nodeAddresses.length);
        for (uint256 i = 0; i < nodeAddresses.length; i++) {
            linked[i] = ndContract.isNodeAlreadyLinked(nodeAddresses[i]);
        }
        return linked;
    }

    function getEscrowDetailsByOwner(
        address owner
    ) external view returns (EscrowDetails memory) {
        address escrowAddr = poaiManager.ownerToEscrow(owner);
        if (escrowAddr == address(0)) {
            return
                EscrowDetails({
                    escrowAddress: address(0),
                    owner: address(0),
                    tvl: 0,
                    activeJobsCount: 0
                });
        }
        return
            EscrowDetails({
                escrowAddress: escrowAddr,
                owner: owner,
                tvl: ICspEscrow(escrowAddr).getTotalJobsBalance(),
                activeJobsCount: ICspEscrow(escrowAddr).getActiveJobsCount()
            });
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

    function getUserEscrowDetails(
        address user
    ) external view returns (UserEscrowDetails memory) {
        (bool isActive, address escrowAddress) = poaiManager
            .getAddressRegistration(user);
        if (!isActive) {
            return
                UserEscrowDetails({
                    isActive: false,
                    escrowAddress: address(0),
                    escrowOwner: address(0),
                    permissions: 0
                });
        }

        address escrowOwner = poaiManager.escrowToOwner(escrowAddress);
        uint256 permissions = escrowOwner == user
            ? ESCROW_OWNER_PERMISSIONS
            : ICspEscrow(escrowAddress).getDelegatePermissions(user);

        return
            UserEscrowDetails({
                isActive: true,
                escrowAddress: escrowAddress,
                escrowOwner: escrowOwner,
                permissions: permissions
            });
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
