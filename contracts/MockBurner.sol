// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IR1Burnable {
    function burn(address from, uint256 amount) external;
}

contract MockBurner {
    IR1Burnable public immutable r1;

    address public lastCaller;
    uint256 public lastAmount;
    uint256 public callCount;

    event BurnCalled(address indexed caller, uint256 amount);

    constructor(address r1Address) {
        require(r1Address != address(0), "Invalid R1 Address");
        r1 = IR1Burnable(r1Address);
    }

    function burn(uint256 amount) external {
        lastCaller = msg.sender;
        lastAmount = amount;
        callCount += 1;
        r1.burn(msg.sender, amount);
        emit BurnCalled(msg.sender, amount);
    }
}
