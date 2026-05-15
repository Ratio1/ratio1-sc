import { ethers } from "hardhat";
import { ND_SC_ADDR } from "../constants";

const LICENSES_TO_BUY = 1;
const REQUESTED_PRICE_TIER = 1;
const MAX_ACCEPTED_TOKEN_PER_LICENSE = 0n;
const INVOICE_UUID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const USD_MINT_LIMIT = 0;
const VAT_PERCENT = 0;
const SIGNATURE = "0x";

async function main() {
  const [deployer] = await ethers.getSigners();

  const ndContract = await ethers.getContractAt(
    "NDContract",
    ND_SC_ADDR,
    deployer
  );

  await ndContract.buyLicense(
    LICENSES_TO_BUY,
    REQUESTED_PRICE_TIER,
    MAX_ACCEPTED_TOKEN_PER_LICENSE,
    INVOICE_UUID,
    USD_MINT_LIMIT,
    VAT_PERCENT,
    SIGNATURE
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
