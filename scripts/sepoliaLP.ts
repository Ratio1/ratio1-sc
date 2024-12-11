import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const pairArtifact = require("@uniswap/v2-periphery/build/IUniswapV2Pair.json");
const { Contract, ContractFactory } = require("ethers");
const factoryArtifact = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerArtifact = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const UNISWAP = require("@uniswap/sdk")

const AMOUNT = BigNumber.from(10).pow(16);
const AMOUNT_1000 = BigNumber.from(10).pow(18).mul(1000);
const AMOUNT_1 = BigNumber.from(10).pow(18);
const AMOUNT_100 = BigNumber.from(10).pow(18).mul(100);


const NAEURATokenAddress = '0x28daE39737984AA73cCf83107e24360C69d69b34';
const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const USDC_ADDRESS = "0xC3121820dEB161CFBe30e3855790fDcd1084d3f6";

const NAEURA_WETH_PAIR_ADDRESS = "0x85a336D59C954C864CF05b7EE6570AB76354F0FA";
const USDC_WETH_PAIR_ADDRESS = "0x92B8274AbA7ab667bEe7Eb776eC1dE32438d90bf";
const UNI_V2_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const UNI_V2_FACTORY_ADDRESS = "0x6650683ff4f6fa1e9f131739973653365ef57c6c"

async function main() {
    const [owner] = await ethers.getSigners();

    const Factory = new ContractFactory(
        factoryArtifact.abi,
        factoryArtifact.bytecode,
        owner
    );
    // const factory = await Factory.deploy(owner.address);

    console.log(`Deploying contracts with the account: ${owner.address}`);

    //ERC20 tokens
    const factoryNAEURA = await ethers.getContractFactory("NAEURA", owner);
    const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);
    console.log(`Using NAEURA from: ${NAEURAToken.address}`);

    const ERC20ABI = require('./ERC20ABI.json');
    const wethToken = new ethers.Contract(WETH_ADDRESS, ERC20ABI, owner);
    console.log(`Using WETH from: ${wethToken.address}`);

    // console.log(`Pair deployed to ${UNI_V2_PAIR_ADDRESS}`);
    // const pair = new Contract(UNI_V2_PAIR_ADDRESS, pairArtifact.abi, owner);
    // let reserves = await pair.getReserves();
    // console.log(`Reserves: ${reserves[0].toString()}, ${reserves[1].toString()}`); //This should be 0,0 since we haven't provided the liquidity to the pair / pool yet.

    // // let tx = await pair.swap(1, 0, owner.address, 0x0, { gasLimit: 100000 });

    // Router
    const router = new Contract(UNI_V2_ROUTER_ADDRESS, routerArtifact.abi, owner);
    console.log(`Using router from address: ${router.address}`);

    // NAEURA-WETH Pair
    const lpToken = new ethers.Contract(NAEURA_WETH_PAIR_ADDRESS, pairArtifact.abi, owner);
    console.log(`Using LP from address: ${lpToken.address}`);

    let reserves = await lpToken.getReserves();
    console.log(`Reserves: ${reserves[0].toString()}, ${reserves[1].toString()}`);


    // address[] memory path = new address[](2);
    // address[] path = [NAEURATokenAddress, WETH_ADDRESS, USDC_ADDRESS];


    let amountEthFromDAI = await router.getAmountsOut(
        BigNumber.from(10).pow(18),
        [NAEURAToken.address, WETH_ADDRESS, USDC_ADDRESS]
    );

    console.log(`Amount of NAEURA from 1 NAEURA: ${amountEthFromDAI}`);

    // Approves
    // await NAEURAToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 100000 })
    // await NAEURAToken.approve(lpToken.address, AMOUNT_1000, { gasLimit: 100000 })
    // await wethToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1, { gasLimit: 100000 })
    // await lpToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1, { gasLimit: 100000 })
    // console.log(`Tokens approved`);


    // Add Liquidity
    // const blockNumber = await ethers.provider.getBlockNumber();
    // const block = await ethers.provider.getBlock(blockNumber);
    // const deadline = block.timestamp + 60 * 20;
    // const tx = await router.addLiquidityETH(NAEURAToken.address, AMOUNT_1000, 0, 0, owner.address, BigNumber.from(deadline).toHexString(), { value: ethers.utils.parseEther("0.1"), gasLimit: 500000 });

    // Remove Liquidity
    // const tx2 = await router.removeLiquidityETH(lpToken.address, AMOUNT_1000, 0, 0, owner.address, BigNumber.from(deadline).toHexString(), { gasLimit: 200000 });
    // console.log("TX hash", tx2.hash);
    // const receipt = await tx.wait();
    // console.log("receipt.logs.length: ", receipt.logs.length);

    // Swap
    // const tx = await router.swapETHForExactTokens(AMOUNT_1000, [WETH_ADDRESS, NAEURAToken.address], owner.address, BigNumber.from(deadline).toHexString(), { value: ethers.utils.parseEther("0.1"), gasLimit: 500000 });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

function IUniswapV2Router02(routerAddress: any): any {
    throw new Error("Function not implemented.");
}
