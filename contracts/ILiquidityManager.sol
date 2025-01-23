// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface ILiquidityManager {
    /**
     * @dev Add liquidity to DEX pool
     * @param r1Amount Amount of R1 tokens to use (half will be swapped)
     * @param liquidityReceiver Address to receive LP tokens and remaining R1 and Stablecoin tokens
     * @return usedAmountR1 Amount of R1 tokens used
     * @return usedAmountStablecoin Amount of Stablecoin tokens used
     */
    function addLiquidity(
        uint256 r1Amount,
        address liquidityReceiver
    ) external returns (uint256, uint256);

    /**
     * @dev Get current price of R1 token in Stablecoin. The result always has 18 decimals.
     * @return price Price of R1 token in Stablecoin
     */
    function getTokenPrice() external view returns (uint256 price);
}
