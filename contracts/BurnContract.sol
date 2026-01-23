// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IR1 {
    function burn(address from, uint256 amount) external;
}

contract BurnContract {
    IR1 public immutable r1;

    constructor(address r1Address) {
        require(r1Address != address(0), "Invalid R1 Address");
        r1 = IR1(r1Address);
    }

    function burn(uint256 amount) external {
        r1.burn(msg.sender, amount);
    }
}
