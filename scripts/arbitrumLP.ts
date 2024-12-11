import { ethers } from "hardhat";
const BigNumber = ethers.BigNumber;

const pairArtifact = require("@uniswap/v2-periphery/build/IUniswapV2Pair.json");
const { Contract, ContractFactory } = require("ethers");
const factoryArtifact = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerArtifact = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const UNISWAP = require("@uniswap/sdk")

const APPROVE_AMOUNT = BigNumber.from(10).pow(16);
const AMOUNT_1000 = BigNumber.from(10).pow(18).mul(1000);
const AMOUNT_1 = BigNumber.from(10).pow(18);


const NAEURATokenAddress = '0x02A38ce9F085d2b2E3a0c93DbFDe5B3afd87BC7c';
// const WETH_ADDRESS = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"; // Sepolia
const WETH_ADDRESS = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" // Arbitrum Sepolia

const UNI_V2_PAIR_ADDRESS = "0x4F15498A278065c7267ac4EDE91418C56C551045";
// const UNI_V2_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008"; // Sepolia
const UNI_V2_ROUTER_ADDRESS = "0x558c56003a871e9b81196c7c86dc046aa69dc66a" // Arbitrum Sepolia

// const UNI_v2_FACTORY_ADDRESS = "0x6650683ff4f6fa1e9f131739973653365ef57c6c" // Sepolia
const UNI_V2_FACTORY_ADDRESS = "0x81158785a8febb965e8e00a26f95884806d7ab4e" // Arbitrum Sepolia


async function main() {
    const [owner] = await ethers.getSigners();

    const Factory = new ContractFactory(
        factoryArtifact.abi,
        factoryArtifact.bytecode,
        owner
    );

    // Factory
    // const factory = await Factory.deploy(owner.address);
    const factory = new Contract(UNI_V2_FACTORY_ADDRESS, factoryArtifact.abi, owner);
    // const pairAddr = await factory.createPair(NAEURATokenAddress, WETH_ADDRESS, { gasLimit: 100000 });


    //Router
    const Router = new ContractFactory(
        routerArtifact.abi,
        routerArtifact.bytecode,
        owner
    );
    // const router = await Router.deploy(factory.address, WETH_ADDRESS);
    const router = new Contract(UNI_V2_ROUTER_ADDRESS, routerArtifact.abi, owner);


    // NAEURA Token
    const factoryNAEURA = await ethers.getContractFactory("NAEURA", owner);
    const NAEURAToken = factoryNAEURA.attach(NAEURATokenAddress);
    console.log(`Using NAEURA from: ${NAEURAToken.address}`);

    await NAEURAToken.approve(UNI_V2_ROUTER_ADDRESS, AMOUNT_1000, { gasLimit: 50000 })
    await NAEURAToken.approve(UNI_V2_PAIR_ADDRESS, AMOUNT_1000, { gasLimit: 50000 })
    console.log(`Tokens approved`);


    // LP
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const deadline = block.timestamp + 60 * 20;
    await router.addLiquidityETH(NAEURATokenAddress, AMOUNT_1000, 0, 0, owner.address, BigNumber.from(deadline).toHexString(), { value: ethers.utils.parseEther("0.01"), gasLimit: 200000 });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });