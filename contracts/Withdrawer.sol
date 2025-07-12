// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract RefundForwarder {
    address public immutable deployer;

    constructor() {
        deployer = msg.sender;
    }

    receive() external payable {}

    modifier onlyDeployer() {
        require(msg.sender == deployer, "Not deployer");
        _;
    }

    function withdrawETH() external onlyDeployer {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        (bool success, ) = deployer.call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    function withdrawERC20(address token) external onlyDeployer {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No token balance");

        bool success = IERC20(token).transfer(deployer, balance);
        require(success, "Token transfer failed");
    }
}
