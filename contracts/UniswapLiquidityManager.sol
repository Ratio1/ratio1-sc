// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ILiquidityManager.sol";

contract UniswapLiquidityManager is ILiquidityManager, Ownable {
    IUniswapV2Router02 _uniswapV2Router;
    address _usdcAddr;
    address _r1Addr;

    constructor(address uniswapV2Router, address usdcAddr, address r1Addr) {
        _uniswapV2Router = IUniswapV2Router02(uniswapV2Router);
        _usdcAddr = usdcAddr;
        _r1Addr = r1Addr;
    }

    function setUniswapParams(
        address uniswapV2Router,
        address usdcAddr
    ) external onlyOwner {
        _uniswapV2Router = IUniswapV2Router02(uniswapV2Router);
        _usdcAddr = usdcAddr;
    }

    function addLiquidity(
        uint256 r1Amount,
        address liquidityReceiver
    ) external override returns (uint256, uint256) {
        IERC20 r1Token = IERC20(_r1Addr);
        r1Token.transferFrom(msg.sender, address(this), r1Amount);
        r1Token.approve(address(_uniswapV2Router), r1Amount);

        uint256 halfR1Amount = r1Amount / 2;
        uint256 usdcAmount = swapTokensForUsdc(halfR1Amount);

        require(usdcAmount > 0, "Swap failed");

        IERC20(_usdcAddr).approve(address(_uniswapV2Router), usdcAmount);
        (uint256 usedAmountR1, uint256 usedAmountUsdc, ) = IUniswapV2Router02(
            _uniswapV2Router
        ).addLiquidity(
                address(r1Token),
                _usdcAddr,
                halfR1Amount,
                usdcAmount,
                0, // Min tokens out
                0, // Min USDC out
                liquidityReceiver,
                block.timestamp
            );

        uint256 remainingAmountR1 = halfR1Amount - usedAmountR1;
        uint256 remainingAmountUsdc = usdcAmount - usedAmountUsdc;

        if (remainingAmountR1 > 0) {
            r1Token.transfer(liquidityReceiver, remainingAmountR1);
        }
        if (remainingAmountUsdc > 0) {
            IERC20(_usdcAddr).transfer(liquidityReceiver, remainingAmountUsdc);
        }

        return (usedAmountR1, usedAmountUsdc);
    }

    function swapTokensForUsdc(uint256 amount) private returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = _r1Addr;
        path[1] = _usdcAddr;

        uint256[] memory amounts = _uniswapV2Router.swapExactTokensForTokens(
            amount, // Amount of tokens to swap
            0, // Minimum amount of tokens to receive
            path, // Path of tokens to swap
            address(this), // Address to receive the swapped tokens
            block.timestamp // Deadline
        );
        return amounts[1];
    }

    function getTokenPrice() external view returns (uint256 price) {
        address[] memory path = new address[](2);
        path[0] = _r1Addr;
        path[1] = _usdcAddr;

        uint256 priceTokenToUsd = _uniswapV2Router.getAmountsOut(
            10 ** 18,
            path
        )[1];

        return priceTokenToUsd * 10 ** 12; // difference in decimals between R1 and USDC
    }
}
