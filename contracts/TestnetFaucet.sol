// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestnetFaucet is Ownable {
    IERC20 public token;
    uint256 public amountPerClaim;
    uint256 public cooldown;

    mapping(address => uint256) public lastRequestTime;

    constructor(IERC20 _token, uint256 _amountPerClaim, uint256 _cooldown) {
        token = _token;
        amountPerClaim = _amountPerClaim;
        cooldown = _cooldown;
    }

    function claim() external {
        require(
            lastRequestTime[msg.sender] + cooldown < block.timestamp,
            "Faucet: You must wait for the cooldown period to claim again"
        );

        lastRequestTime[msg.sender] = block.timestamp;

        token.transfer(msg.sender, amountPerClaim);
    }

    function changeSettings(
        address _token,
        uint256 _amountPerClaim,
        uint256 _cooldown
    ) external onlyOwner {
        token = IERC20(_token);
        amountPerClaim = _amountPerClaim;
        cooldown = _cooldown;
    }

    function withdraw(address _token) external onlyOwner {
        IERC20 _ierc20Token = IERC20(_token);
        _ierc20Token.transfer(
            msg.sender,
            _ierc20Token.balanceOf(address(this))
        );
    }

    function getNextClaimTimestamp(
        address _address
    ) external view returns (uint256) {
        return lastRequestTime[_address] + cooldown;
    }
}
