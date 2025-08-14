import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
//import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/types/config";
import "solidity-coverage";
import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

const BE_SIGNER_PRIVATE_KEY = process.env.BE_SIGNER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY =
  process.env.ETHERSCAN_API_KEY || "YF24C96CAMZQIQ1TZV5Q21J1XQWDWDRT93";
const COINMARKETCAP_API_KEY =
  process.env.COINMARKETCAP_API_KEY || "fe216009-c5aa-4629-874e-f43901af5108";

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
  },
  gasReporter: {
    offline: true,
    enabled: true,
    currency: "EUR",
    token: "ETH",
    L2: "base",
    trackGasDeltas: true,
    //coinmarketcap: COINMARKETCAP_API_KEY,
    etherscan: ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 480000,
    parallel: false,
  },
};

export default config;
//require("hardhat-contract-sizer");
