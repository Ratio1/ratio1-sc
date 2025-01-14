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

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountA,
        uint amountB,
        uint minAmountA,
        uint minAmountB,
        address to,
        uint deadline
    ) public returns (uint, uint, uint) {
        uint x = amountA - 1;
        uint y = amountB - 1;
        return (x, y, 1);
    }

    function swapExactTokensForTokens(
        uint amount,
        uint minAmount,
        address[] memory path,
        address to,
        uint deadline
    ) public returns (uint[] memory) {
        uint[] memory result = new uint[](2);
        result[0] = 0;
        result[1] = (amount / 10 ** 18) * 10 ** 6;
        return result;
    }
}
