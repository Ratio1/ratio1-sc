// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20("Mock", "MK") {
    bool public transferFromCalled = false;

    bool public transferCalled = false;
    address public transferRecipient = address(0);
    uint256 public transferAmount = 0;

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address user, uint256 amount) public {
        _mint(user, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        transferFromCalled = true;

        return super.transferFrom(sender, recipient, amount);
    }

    function transfer(
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        transferCalled = true;
        transferRecipient = recipient;
        transferAmount = amount;

        // For testing purposes, allow transfers to zero address (burning)
        if (recipient == address(0)) {
            _burn(msg.sender, amount);
            return true;
        }

        return super.transfer(recipient, amount);
    }

    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}
