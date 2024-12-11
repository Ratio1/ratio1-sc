// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
// import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol"; // Add this line
import "./NAEURA.sol";

contract TestContract {
    NAEURA private _token;
    address public routerAddr;

    uint256 lastReceivedEth;

    IUniswapV2Router02 _uniswapV2Router;
    IUniswapV2Factory _uniswapV2Factory;
    // IUniswapV2Pair _uniswapV2Pair;

    constructor(address tokenAddress, address uniswapV2Router_) {
        _token = NAEURA(tokenAddress);
        _uniswapV2Router = IUniswapV2Router02(uniswapV2Router_);
        // _uniswapV2Pair = IUniswapV2Pair(uniswapV2Pair_);
        _uniswapV2Factory = IUniswapV2Factory(_uniswapV2Router.factory()); // This does not exist on Sepolia
    }

    // This will work only if the Factory contract is deployed
    function getLpTokenAddress() public view returns (address) {
        address lpAddr = _uniswapV2Factory.getPair(
            _uniswapV2Router.WETH(),
            address(_token)
        );

        return lpAddr;
    }

    function getNAEURANAEURABalance() public view returns (uint256) {
        return _token.balanceOf(address(this));
    }

    function approveNAEURA(uint256 amount) public {
        _token.approve(address(_uniswapV2Router), amount);
    }

    function addLiquidity(
        uint256 tokenAmount,
        uint256 ethAmount
    ) public payable {
        _token.transferFrom(msg.sender, address(this), tokenAmount);
        approveNAEURA(tokenAmount);

        _uniswapV2Router.addLiquidityETH{value: ethAmount}(
            address(_token),
            tokenAmount,
            0,
            0,
            address(this),
            block.timestamp + 1000
        );
    }

    function swapETHForTokens(uint256 amount) public payable {
        address[] memory path = new address[](2);
        path[0] = _uniswapV2Router.WETH();
        path[1] = address(_token);

        _uniswapV2Router.swapExactETHForTokens{value: amount}(
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    function swapTokensForETH(
        uint256 amount
    ) public payable returns (uint amountETH) {
        // Transfer the tokens from the caller to the contract
        _token.transferFrom(msg.sender, address(this), amount);
        approveNAEURA(amount);

        // Check if the contract has enough allowance to transfer the tokens
        require(
            _token.allowance(msg.sender, address(this)) >= amount,
            "Insufficient allowance"
        );

        address[] memory path = new address[](2);
        path[0] = address(_token);
        path[1] = _uniswapV2Router.WETH();

        uint256[] memory amounts = _uniswapV2Router.swapExactTokensForETH(
            amount,
            0,
            path,
            address(this),
            block.timestamp
        );
        uint256 amountEth = amounts[1];

        return amountEth;
    }

    function handlePayment(uint256 totalCost) public payable {
        _token.transferFrom(msg.sender, address(this), totalCost);

        // Check if the contract has enough allowance to transfer the tokens
        require(
            _token.allowance(msg.sender, address(this)) >= totalCost,
            "Insufficient NAEURA allowance to buy licenses"
        );

        // uint256 burnAmount = (totalCost * 20) / 100; // NAEURA will be burnt
        uint256 swapAmount = (totalCost * 30) / 100; // NAEURA will become ETH
        uint256 liquidityAmount = (totalCost * 30) / 100; // NAEURA that will be added with ETH to LP

        // Burn 20% of _token
        // _token.burn(msg.sender, burnAmount);

        // Swap 30% of _token to WETH
        approveNAEURA(swapAmount);
        uint256 amountEth = swapTokensForETH(swapAmount);

        // Add liquidity with 30% _token and 30% WETH
        approveNAEURA(liquidityAmount);
        addLiquidity(liquidityAmount, amountEth);
    }

    receive() external payable {}
}
