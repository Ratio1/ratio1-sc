import { ethers } from "hardhat";
import {
  MND_SC_ADDR,
  ND_SC_ADDR,
  NEW_COMPANY_WALLET,
  NEW_CSR_WALLET,
  NEW_EXPENSES_WALLET,
  NEW_GRANTS_WALLET,
  NEW_LP_WALLET,
  NEW_MARKETING_WALLET,
  NEW_VAT_RECEIVER_WALLET,
} from "../constants";

async function main() {
  const [deployer] = await ethers.getSigners();
  const wallets = [
    { name: "NEW_COMPANY_WALLET", value: NEW_COMPANY_WALLET },
    { name: "NEW_LP_WALLET", value: NEW_LP_WALLET },
    { name: "NEW_VAT_RECEIVER_WALLET", value: NEW_VAT_RECEIVER_WALLET },
    { name: "NEW_EXPENSES_WALLET", value: NEW_EXPENSES_WALLET },
    { name: "NEW_MARKETING_WALLET", value: NEW_MARKETING_WALLET },
    { name: "NEW_GRANTS_WALLET", value: NEW_GRANTS_WALLET },
    { name: "NEW_CSR_WALLET", value: NEW_CSR_WALLET },
  ];

  for (const wallet of wallets) {
    if (!ethers.isAddress(wallet.value)) {
      throw new Error(`${wallet.name} is not a valid address`);
    }
  }

  const mndContract = await ethers.getContractAt(
    "MNDContract",
    MND_SC_ADDR,
    deployer
  );

  await mndContract.setCompanyWallets(
    NEW_LP_WALLET,
    NEW_EXPENSES_WALLET,
    NEW_MARKETING_WALLET,
    NEW_GRANTS_WALLET,
    NEW_CSR_WALLET
  );
  console.log("Company wallets set in MND contract");

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );

  await ndContract.setCompanyWallets(
    NEW_COMPANY_WALLET,
    NEW_LP_WALLET,
    NEW_VAT_RECEIVER_WALLET
  );
  console.log("Company wallets set in ND contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
