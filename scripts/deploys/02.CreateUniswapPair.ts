import { ethers } from "hardhat";
import { Contract } from "ethers";
import {
  R1_TOKEN_ADDR,
  UNISWAP_V2_ROUTER_ADDR,
  USDC_TOKEN_ADDR,
} from "../configs/constants";
import { sleep } from "../utils/sleep";

const ROUTER_ABI = ["function factory() external view returns (address)"];
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)",
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];
const PAIR_POLL_ATTEMPTS = 6;
const PAIR_POLL_DELAY_MS = 5000;

async function getPairAddress(
  factory: Contract,
  tokenA: string,
  tokenB: string
) {
  const pairAddress = await factory.getPair(tokenA, tokenB);
  if (pairAddress !== ethers.ZeroAddress) {
    return pairAddress;
  }

  return factory.getPair(tokenB, tokenA);
}

async function pollPairAddress(
  factory: Contract,
  tokenA: string,
  tokenB: string
) {
  for (let i = 0; i < PAIR_POLL_ATTEMPTS; i++) {
    const pairAddress = await getPairAddress(factory, tokenA, tokenB);
    if (pairAddress !== ethers.ZeroAddress) {
      return pairAddress;
    }
    await sleep(PAIR_POLL_DELAY_MS);
  }

  return ethers.ZeroAddress;
}

async function main() {
  const [deployer] = await ethers.getSigners();

  if (!ethers.isAddress(R1_TOKEN_ADDR)) {
    throw new Error("R1_TOKEN_ADDR is not a valid address");
  }
  if (!ethers.isAddress(USDC_TOKEN_ADDR)) {
    throw new Error("USDC_TOKEN_ADDR is not a valid address");
  }
  if (!ethers.isAddress(UNISWAP_V2_ROUTER_ADDR)) {
    throw new Error("UNISWAP_V2_ROUTER_ADDR is not a valid address");
  }

  const router = new ethers.Contract(
    UNISWAP_V2_ROUTER_ADDR,
    ROUTER_ABI,
    deployer
  );
  const factoryAddress = await router.factory();
  const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, deployer);
  const factoryCode = await ethers.provider.getCode(factoryAddress);
  if (factoryCode === "0x") {
    throw new Error(`No contract found at factory address ${factoryAddress}`);
  }

  let pairAddress = await getPairAddress(
    factory,
    R1_TOKEN_ADDR,
    USDC_TOKEN_ADDR
  );
  if (pairAddress === ethers.ZeroAddress) {
    console.log("Creating Uniswap V2 pair...");
    const tx = await factory.createPair(R1_TOKEN_ADDR, USDC_TOKEN_ADDR);
    const receipt = await tx.wait();
    console.log("Pair creation tx:", tx.hash);
    console.log("Pair creation status:", receipt?.status);
    console.log("Pair creation block:", receipt?.blockNumber);

    if (receipt?.status !== 1) {
      throw new Error("Pair creation transaction failed");
    }

    for (const log of receipt.logs) {
      try {
        const parsedLog = factory.interface.parseLog(log);
        if (parsedLog?.name === "PairCreated") {
          pairAddress = parsedLog.args.pair;
          break;
        }
      } catch {
        // Ignore logs emitted by other contracts.
      }
    }

    if (pairAddress === ethers.ZeroAddress) {
      pairAddress = await pollPairAddress(
        factory,
        R1_TOKEN_ADDR,
        USDC_TOKEN_ADDR
      );
    }
  }

  if (pairAddress === ethers.ZeroAddress) {
    throw new Error(
      "Pair address is still zero after createPair. Check the router/factory addresses and the selected network."
    );
  }

  console.log("Uniswap V2 factory:", factoryAddress);
  console.log("Uniswap V2 pair:", pairAddress);
  console.log("Set UNISWAP_V2_PAIR_ADDR to:", pairAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
