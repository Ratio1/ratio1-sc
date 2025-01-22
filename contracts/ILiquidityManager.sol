// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface ILiquidityManager {
    /**
     * @dev Add liquidity to DEX pool
     * @param r1Amount Amount of R1 tokens to use (half will be swapped)
     * @param liquidityReceiver Address to receive LP tokens and remaining R1 and USDC tokens
     * @return usedAmountR1 Amount of R1 tokens used
     * @return usedAmountUsdc Amount of USDC tokens used
     */
    function addLiquidity(
        uint256 r1Amount,
        address liquidityReceiver
    ) external returns (uint256, uint256);

    /**
     * @dev Get current price of R1 token in USDC
     * @return price Price of R1 token in USDC
     */
    function getTokenPrice() external view returns (uint256 price);
}
