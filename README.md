# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a script that deploys that contract.

Install dependencies:

```shell
npm install
```

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.ts
```

Deployment steps

1. Deploy R1 token SC
2. Deploy MND Contract
3. Whitelist MND Contract in the R1 token SC
4. Deploy Liquidity Manager
5. Deploy ND Contract
6. Whitelist ND Contract in the R1 token SC
7. Set Liquidity Manager SC in ND Contract
