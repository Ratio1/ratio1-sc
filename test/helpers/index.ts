import { ethers } from "hardhat";
import { Signer } from "ethers";
import { NDContract, R1 } from "../../typechain-types";

let invoiceNonce = 0;

export function generateInvoiceUuid(label: string = "invoice"): string {
  const data = ethers.solidityPacked(["string", "uint256"], [label, invoiceNonce++]);
  return ethers.keccak256(data);
}

export async function signBuyLicense(
  signer: Signer,
  buyerAddress: string,
  invoiceUuid: string,
  usdMintLimit: bigint,
  vatPercent: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "uint256", "uint256"],
    [buyerAddress, invoiceUuid, usdMintLimit, vatPercent]
  );
  return signer.signMessage(ethers.getBytes(messageHash));
}

export async function signLinkNode(
  signer: Signer,
  user: Signer,
  nodeAddress: string
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "address"],
    [await user.getAddress(), nodeAddress]
  );
  return signer.signMessage(ethers.getBytes(messageHash));
}

interface BuyLicenseParams {
  r1: R1;
  nd: NDContract;
  mintAuthority: Signer;
  buyer: Signer;
  oracleSigner: Signer;
  nodeAddress: string;
  priceTier?: number;
  vatPercent?: number;
  usdMintLimit?: bigint;
  invoiceUuid?: string;
  licenseCount?: number;
}

export async function buyLicenseAndLinkNode({
  r1,
  nd,
  mintAuthority,
  buyer,
  oracleSigner,
  nodeAddress,
  priceTier = 1,
  vatPercent = 20,
  usdMintLimit = 10_000n,
  invoiceUuid,
  licenseCount = 1,
}: BuyLicenseParams) {
  const buyerAddress = await buyer.getAddress();
  const resolvedInvoiceUuid = invoiceUuid ?? generateInvoiceUuid("poai-nd");
  const licensesToBuy = BigInt(licenseCount);
  const tokenPrice = await nd.getLicenseTokenPrice();
  const totalWithoutVat = tokenPrice * licensesToBuy;
  const vatAmount = (totalWithoutVat * BigInt(vatPercent)) / 100n;
  const totalWithVat = totalWithoutVat + vatAmount;
  const maxAccepted = totalWithVat + totalWithVat / 10n;

  await r1
    .connect(mintAuthority)
    .mint(buyerAddress, maxAccepted);
  await r1
    .connect(buyer)
    .approve(await nd.getAddress(), maxAccepted);

  const signature = await signBuyLicense(
    oracleSigner,
    buyerAddress,
    resolvedInvoiceUuid,
    usdMintLimit,
    vatPercent
  );

  await nd
    .connect(buyer)
    .buyLicense(
      Number(licensesToBuy),
      priceTier,
      maxAccepted,
      resolvedInvoiceUuid,
      usdMintLimit,
      vatPercent,
      signature
    );

  const licenses = await nd.getLicenses(buyerAddress);
  const latestLicense = licenses[licenses.length - 1];
  const ndLicenseId = Number(latestLicense.licenseId);

  const linkSignature = await signLinkNode(oracleSigner, buyer, nodeAddress);
  await nd
    .connect(buyer)
    .linkNode(ndLicenseId, nodeAddress, linkSignature);

  return ndLicenseId;
}
