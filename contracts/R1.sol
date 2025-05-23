// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

contract R1 is Ownable, ERC20Capped {
    // Max supply of R1: 161.803.398
    uint256 public constant maxSupply = 161803398 * (10 ** 18);
    address public _mndContract;
    address public _ndContract;
    mapping(address => bool) private _burners;

    // Constructor will be called on contract creation
    constructor(
        address newOwner
    ) ERC20("Ratio1", "R1") ERC20Capped(maxSupply) Ownable(newOwner) {}

    function _canMint() private view returns (bool) {
        return msg.sender == _mndContract || msg.sender == _ndContract;
    }

    function _canBurn() private view returns (bool) {
        return msg.sender == _ndContract || _burners[msg.sender];
    }

    function mint(address to, uint256 amount) external {
        require(_canMint(), "Only allowed contracts can mint");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(_canBurn(), "Only allowed contracts can burn");
        _burn(from, amount);
    }

    function setMndContract(address mndContract) external onlyOwner {
        require(
            _mndContract == address(0),
            "Master Node Deed address already set"
        );
        require(mndContract != address(0), "Invalid Master Node Deed address");
        _mndContract = mndContract;
    }

    function setNdContract(address ndContract) external onlyOwner {
        require(_ndContract == address(0), "Node Deed address already set");
        require(ndContract != address(0), "Invalid Node Deed address");
        _ndContract = ndContract;
    }

    function addBurner(address account) external onlyOwner {
        require(account != address(0), "Invalid burner address");
        _burners[account] = true;
    }

    function removeBurner(address account) external onlyOwner {
        require(_burners[account], "Address is not a burner");
        _burners[account] = false;
    }
}
