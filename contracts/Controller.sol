// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Controller is Ownable {
    using ECDSA for bytes32;

    uint256 public constant startEpochTimestamp = 1738771200; // Wednesday 5 February 2025 16:00:00 UTC
    uint256 public constant epochDuration = 24 hours;

    uint256 public constant MAX_PERCENTAGE = 100_00;
    uint8 public constant MAX_AVAILABILITY = 255;

    uint256 public constant PRICE_DECIMALS = 10 ** 18;

    uint256 public constant MAX_TOKEN_SUPPLY = 161803398 * PRICE_DECIMALS;
    uint8 public constant LAST_PRICE_TIER = 12;

    // NODE DEEDS (ND)
    uint256 public constant ND_MAX_LICENSE_SUPPLY = 46224;
    uint256 public constant ND_MAX_LICENSE_TOKENS_PERCENTAGE = 45_00; // 45% of total supply
    uint256 public constant ND_MAX_LICENSE_TOKENS_SUPPLY =
        (MAX_TOKEN_SUPPLY * ND_MAX_LICENSE_TOKENS_PERCENTAGE) / MAX_PERCENTAGE;
    uint256 public constant ND_MAX_MINING_PER_LICENSE =
        ND_MAX_LICENSE_TOKENS_SUPPLY / ND_MAX_LICENSE_SUPPLY;
    uint256 public constant ND_MINING_DURATION_EPOCHS = 36 * 30;
    uint256 public constant ND_MAX_RELEASE_PER_DAY =
        ND_MAX_MINING_PER_LICENSE / ND_MINING_DURATION_EPOCHS;

    // MASTER NODE DEEDS (MND)
    uint256 public constant MND_MAX_TOKENS_ASSIGNED_PER_LICENSE =
        (MAX_TOKEN_SUPPLY * 2_00) / MAX_PERCENTAGE;
    uint256 public constant MND_MAX_TOTAL_ASSIGNED_TOKENS =
        (MAX_TOKEN_SUPPLY * 26_10) / MAX_PERCENTAGE; // 26.1% of total supply
    uint256 public constant MND_MAX_SUPPLY = 500;
    uint256 public constant MND_NO_MINING_EPOCHS = 30 * 4;
    uint256 public constant MND_MINING_DURATION_EPOCHS = 30 * 30;

    uint256 public constant GND_TOTAL_EMISSION =
        (MAX_TOKEN_SUPPLY * 28_90) / MAX_PERCENTAGE; // 28.9% of total supply
    uint256 public constant GND_MINING_EPOCHS = 365;
    uint256 public constant GND_TOKEN_ID = 1;

    address[] public oracles;
    uint8 public minimumRequiredSignatures;
    mapping(address => bool) isOracle;
    mapping(address => uint256) public oracleSignaturesCount;
    mapping(address => uint256) public oracleAdditionTimestamp;

    event OracleAdded(address newOracle);
    event OracleRemoved(address removedOracle);

    constructor() {}

    function setMinimumRequiredSignatures(
        uint8 _minimumRequiredSignatures
    ) public onlyOwner {
        minimumRequiredSignatures = _minimumRequiredSignatures;
    }

    function getOracles() public view returns (address[] memory) {
        return oracles;
    }

    function requireVerifySignatures(
        bytes32 ethSignedMessageHash,
        bytes[] memory signatures,
        bool requireMinimumSignatures
    ) public returns (address) {
        if (requireMinimumSignatures) {
            require(
                signatures.length >= minimumRequiredSignatures,
                "Insufficient signatures"
            );
        }
        address[] memory seenOracles = new address[](signatures.length);
        for (uint i = 0; i < signatures.length; i++) {
            address signerAddress = ethSignedMessageHash.recover(signatures[i]);
            require(isOracle[signerAddress], "Invalid oracle signature");
            for (uint j = 0; j < seenOracles.length; j++) {
                require(
                    seenOracles[j] != signerAddress,
                    "Duplicate oracle signature"
                );
            }
            seenOracles[i] = signerAddress;
            oracleSignaturesCount[signerAddress]++;
        }
        return seenOracles[0];
    }

    function addOracle(address newOracle) public onlyOwner {
        require(newOracle != address(0), "Invalid oracle address");
        require(!isOracle[newOracle], "Oracle already exists");
        isOracle[newOracle] = true;
        oracleSignaturesCount[newOracle] = 0;
        oracleAdditionTimestamp[newOracle] = block.timestamp;
        oracles.push(newOracle);
        emit OracleAdded(newOracle);
    }

    function removeOracle(address oracleToRemove) public onlyOwner {
        require(isOracle[oracleToRemove], "Oracle does not exist");
        isOracle[oracleToRemove] = false;
        for (uint i = 0; i < oracles.length; i++) {
            if (oracles[i] == oracleToRemove) {
                oracles[i] = oracles[oracles.length - 1];
                oracles.pop();
                break;
            }
        }
        emit OracleRemoved(oracleToRemove);
    }
}
