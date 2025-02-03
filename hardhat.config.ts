import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import "solidity-coverage";

// Replace this private key with your Sepolia account private key
// To export your private key from Coinbase Wallet, go to
// Settings > Developer Settings > Show private key
// To export your private key from Metamask, open Metamask and
// go to Account Details > Export Private Key
// Beware: NEVER put real Ether into testing accounts
const GENESIS =
  "66b9258bc5a362001caf767ac12d1d60d4259b035f1a552168ce4a728ae0d204"; // TODO: complete with your own private key
const MASTER =
  "66b9258bc5a362001caf767ac12d1d60d4259b035f1a552168ce4a728ae0d204"; // TODO: complete with your own private key
const API_URL =
  "https://eth-sepolia.g.alchemy.com/v2/6Q-AFwrpUJu-cO16YX8EjgqLOJVKoXHT"; // TODO: complete with your own API URL
const ARBITRUM_SEPOLIA_API_URL =
  "https://arb-sepolia.g.alchemy.com/v2/B4Z__ANFV56xN6wR9OOhj5nr3T6t5WKS"; // TODO: complete with your own API URL
const ARBITRUM_MAINNET =
  "https://arb-mainnet.g.alchemy.com/v2/6Q-AFwrpUJu-cO16YX8EjgqLOJVKoXHT";

const BE_SIGNER_PRIVATE_KEY = "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
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
      //accounts: [BE_SIGNER_PRIVATE_KEY],
    },
  },
  /*networks: {
    arbitrum: {
      url: ARBITRUM_MAINNET,
      accounts: [GENESIS, MASTER],
    },
    sepolia: {
      chainId: 11155111,
      url: API_URL,
      accounts: [GENESIS, MASTER],
    },
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_API_URL,
      chainId: 421614,
      accounts: [GENESIS, MASTER],
    },
  },*/
  gasReporter: {
    currency: "EUR",
    enabled: true,
    //L2: "arbitrum",
    //L1: "ethereum",
    //trackGasDeltas: true,
    coinmarketcap: "fe216009-c5aa-4629-874e-f43901af5108",
    //L1Etherscan:"YF24C96CAMZQIQ1TZV5Q21J1XQWDWDRT93",
    //L2Etherscan: "I32XUBSQGUM2S3CYT2S4S2PPYFSCI23DT2",
  },
  mocha: {
    timeout: 480000,
    parallel: false,
  },
};

export default config;
require("hardhat-contract-sizer");
