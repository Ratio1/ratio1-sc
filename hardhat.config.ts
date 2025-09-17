import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/types/config";
import "solidity-coverage";
import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const accounts = SIGNER_PRIVATE_KEY ? [SIGNER_PRIVATE_KEY] : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  paths: {
    tests: "./test",
  },
  networks: {
    hardhat: {
      chainId: 1337,
      initialDate: "2025-02-02T15:00:00Z",
    },
    baseSepolia: {
      chainId: 84532,
      url: "https://base-sepolia-rpc.publicnode.com",
      accounts,
    },
    base: {
      chainId: 8453,
      url: "https://mainnet.base.org",
      accounts,
    },
  },
  gasReporter: {
    offline: true,
    enabled: true,
    currency: "EUR",
    token: "ETH",
    L2: "base",
    trackGasDeltas: true,
    etherscan: ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 480000,
    parallel: false,
  },
  etherscan: {
    apiKey: {
      baseSepolia: ETHERSCAN_API_KEY,
      base: ETHERSCAN_API_KEY,
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};

export default config;
//require("hardhat-contract-sizer");
