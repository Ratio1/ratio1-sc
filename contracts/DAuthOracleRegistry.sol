// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IControllerOracles {
    function getOracles() external view returns (address[] memory);
}

contract DAuthOracleRegistry is Ownable {
    IControllerOracles public controller;

    address[] private _dAuthOracles;
    mapping(address => bool) private _isDAuthOracle;

    event DAuthOracleAdded(address newDAuthOracle);
    event DAuthOracleRemoved(address removedDAuthOracle);

    constructor(address controllerAddress, address newOwner) Ownable(newOwner) {
        require(controllerAddress != address(0), "Invalid controller address");
        controller = IControllerOracles(controllerAddress);
    }

    function getDAuthOracles() public view returns (address[] memory) {
        uint256 activeDAuthOraclesCount = 0;
        for (uint i = 0; i < _dAuthOracles.length; i++) {
            if (_isControllerOracle(_dAuthOracles[i])) {
                activeDAuthOraclesCount++;
            }
        }

        address[] memory activeDAuthOracles = new address[](
            activeDAuthOraclesCount
        );
        uint256 activeDAuthOracleIndex = 0;
        for (uint i = 0; i < _dAuthOracles.length; i++) {
            if (_isControllerOracle(_dAuthOracles[i])) {
                activeDAuthOracles[activeDAuthOracleIndex] = _dAuthOracles[i];
                activeDAuthOracleIndex++;
            }
        }

        return activeDAuthOracles;
    }

    function isDAuthOracle(address oracleAddress) public view returns (bool) {
        return
            _isDAuthOracle[oracleAddress] &&
            _isControllerOracle(oracleAddress);
    }

    function addDAuthOracle(address newDAuthOracle) public onlyOwner {
        require(newDAuthOracle != address(0), "Invalid dAuth oracle address");
        require(
            !_isDAuthOracle[newDAuthOracle],
            "dAuth oracle already exists"
        );
        require(
            _isControllerOracle(newDAuthOracle),
            "Address is not Controller oracle"
        );

        _isDAuthOracle[newDAuthOracle] = true;
        _dAuthOracles.push(newDAuthOracle);
        emit DAuthOracleAdded(newDAuthOracle);
    }

    function removeDAuthOracle(address dAuthOracleToRemove) public onlyOwner {
        require(
            _isDAuthOracle[dAuthOracleToRemove],
            "dAuth oracle does not exist"
        );

        _isDAuthOracle[dAuthOracleToRemove] = false;
        for (uint i = 0; i < _dAuthOracles.length; i++) {
            if (_dAuthOracles[i] == dAuthOracleToRemove) {
                _dAuthOracles[i] = _dAuthOracles[_dAuthOracles.length - 1];
                _dAuthOracles.pop();
                break;
            }
        }
        emit DAuthOracleRemoved(dAuthOracleToRemove);
    }

    function _isControllerOracle(
        address oracleAddress
    ) private view returns (bool) {
        address[] memory controllerOracles = controller.getOracles();
        for (uint i = 0; i < controllerOracles.length; i++) {
            if (controllerOracles[i] == oracleAddress) {
                return true;
            }
        }
        return false;
    }
}
