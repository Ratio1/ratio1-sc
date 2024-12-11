import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;
import { Contract } from "ethers";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import pairArtifact from "@uniswap/v2-periphery/build/IUniswapV2Pair.json";


const UNI_V2_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const NAEURATokenAddress = '0x1a40D28a39f65cd8cCb8F5089DF1b729184A83b9';
const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const LP_ADDRESS = "0x85a336D59C954C864CF05b7EE6570AB76354F0FA";

const TEST_CONTRACT_ADDRESS = "0xB42cA24FC0CaAC7C931228Bda79DAdFB5c5F564e";

const AMOUNT_100 = BigNumber.from(10).pow(18).mul(100);
const AMOUNT_1000 = BigNumber.from(10).pow(18).mul(10000);
const ETH_AMOUNT = BigNumber.from(10).pow(16);

async function main() {
    const [owner] = await ethers.getSigners();

    //ERC20 tokens
    const factoryNAEURA = await ethers.getContractFactory("NAEURA", owner);
    const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);
    console.log(`Using NAEURA from: ${NAEURAToken.address}`);

    const ERC20ABI = require('./ERC20ABI.json');
    const wethToken = new ethers.Contract(WETH_ADDRESS, ERC20ABI, owner);
    console.log(`Using WETH from: ${wethToken.address}`);

    const lpToken = new ethers.Contract(LP_ADDRESS, pairArtifact.abi, owner);
    console.log(`Using LP from address: ${lpToken.address}`);


    // Router
    const router = new Contract(UNI_V2_ROUTER_ADDRESS, routerArtifact.abi, owner);
    console.log(`Using router from address: ${router.address}`);


    // TestContract
    const TestContract = await ethers.getContractFactory("TestContract");

    // comment next line or the following line to deploy or to use the deployed contract
    // const testContract = await TestContract.deploy(NAEURAToken.address, router.address);
    const testContract = TestContract.attach(TEST_CONTRACT_ADDRESS);

    console.log("TestContract address:", testContract.address);


    // Approves
    await NAEURAToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 100000 })
    await NAEURAToken.approve(testContract.address, AMOUNT_1000, { gasLimit: 100000 })
    // await NAEURAToken.approve(owner.address, AMOUNT_1000, { gasLimit: 100000 })

    // await lpToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 100000 })
    // await lpToken.approve(testContract.address, AMOUNT_1000, { gasLimit: 100000 })
    // await NAEURAToken.approve(lpToken.address, AMOUNT_1000, { gasLimit: 100000 })
    // await lpToken.approve(NAEURAToken.address, AMOUNT_1000, { gasLimit: 100000 })

    // Add Liquidity
    // const tx = await testContract.addLiquidity(AMOUNT_100, ETH_AMOUNT, { value: ethers.utils.parseEther("0.01"), gasLimit: 500000 });
    // console.log("Add Liquidity tx:", tx.hash);

    // // Swap ETH for Tokens
    // const tx2 = await testContract.swapETHForTokens(ETH_AMOUNT, { value: ethers.utils.parseEther("0.01"), gasLimit: 500000 });
    // console.log("Swap tx:", tx2.hash);

    // Swap Tokens for ETH
    const tx3 = await testContract.swapTokensForETH(AMOUNT_100, { gasLimit: 500000 });
    console.log("Swap tx:", tx3.hash);

    // await NAEURAToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 100000 })
    // await NAEURAToken.approve(testContract.address, AMOUNT_1000, { gasLimit: 100000 })
    // Handle Payment
    // const tx4 = await testContract.handlePayment(AMOUNT_100, { gasLimit: 500000 });
    // console.log("Handle Payment tx:", tx4.hash);
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });