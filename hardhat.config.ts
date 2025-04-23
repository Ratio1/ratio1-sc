import { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
//import "@nomicfoundation/hardhat-toolbox";
//import "hardhat-gas-reporter";
//import "solidity-coverage";
import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

const BE_SIGNER_PRIVATE_KEY = process.env.BE_SIGNER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
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
      accounts: [BE_SIGNER_PRIVATE_KEY],
    },
    base: {
      chainId: 8453,
      url: "https://mainnet.base.org",
      accounts: [BE_SIGNER_PRIVATE_KEY],
    },
  },
  /*gasReporter: {
    currency: "EUR",
    enabled: true,
    L2: "base",
    trackGasDeltas: true,
    coinmarketcap: "fe216009-c5aa-4629-874e-f43901af5108",
    L2Etherscan: ETHERSCAN_API_KEY,
  },*/
  mocha: {
    timeout: 480000,
    parallel: false,
  },
  /*etherscan: {
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
  },*/
};

export default config;
//require("hardhat-contract-sizer");
