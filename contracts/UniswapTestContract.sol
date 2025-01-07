pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";

contract UNISWAP is Ownable {
    constructor() {}

    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) public view returns (uint[] memory) {
        uint[] memory result = new uint[](2);
        result[0] = 0;
        result[1] = 1 * 10 ** 6;
        return result;
    }
}
