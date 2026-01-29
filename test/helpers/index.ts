import { ethers, upgrades } from "hardhat";
import { BigNumberish, BytesLike, Signer } from "ethers";
import {
  Controller,
  ERC20Mock,
  MNDContract,
  NDContract,
  R1,
  UniswapMockPair,
  UniswapMockRouter,
} from "../../typechain-types";

let invoiceNonce = 0;

export const START_EPOCH_TIMESTAMP = 1738767600;
export const ONE_DAY_IN_SECS = 24 * 60 * 60;
export const NODE_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ONE_TOKEN = 10n ** 18n;

function normalizeHex(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

export async function setNextBlockTimestamp(
  timestamp: number | bigint
): Promise<void> {
  const nextTimestamp =
    typeof timestamp === "bigint" ? Number(timestamp) : timestamp;
  await ethers.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);
}

export async function mineBlock(): Promise<void> {
  await ethers.provider.send("evm_mine", []);
}

export async function setTimestampAndMine(
  timestamp: number | bigint
): Promise<void> {
  await setNextBlockTimestamp(timestamp);
  await mineBlock();
}

export async function takeSnapshot(): Promise<string> {
  return ethers.provider.send("evm_snapshot", []);
}

export async function revertSnapshot(snapshotId: string): Promise<void> {
  await ethers.provider.send("evm_revert", [snapshotId]);
}

export async function revertSnapshotAndCapture(
  snapshotId: string
): Promise<string> {
  await revertSnapshot(snapshotId);
  return takeSnapshot();
}

export async function deployR1(owner: Signer): Promise<R1> {
  const factory = await ethers.getContractFactory("R1");
  const contract = (await factory.deploy(
    await owner.getAddress()
  )) as unknown as R1;
  await contract.waitForDeployment();
  return contract;
}

export async function deployController({
  owner,
  startEpoch = START_EPOCH_TIMESTAMP,
  epochDuration = ONE_DAY_IN_SECS,
  oracleSigners = [],
}: {
  owner: Signer;
  startEpoch?: number;
  epochDuration?: number;
  oracleSigners?: Array<Signer | string>;
}): Promise<Controller> {
  const factory = await ethers.getContractFactory("Controller");
  const controller = (await factory.deploy(
    startEpoch,
    epochDuration,
    await owner.getAddress()
  )) as unknown as Controller;
  await controller.waitForDeployment();

  for (const oracle of oracleSigners) {
    const oracleAddress =
      typeof oracle === "string" ? oracle : await oracle.getAddress();
    await controller.addOracle(oracleAddress);
  }

  return controller;
}

export async function deployNDContract({
  r1,
  controller,
  owner,
}: {
  r1: R1;
  controller: Controller;
  owner: Signer;
}): Promise<NDContract> {
  const factory = await ethers.getContractFactory("NDContract");
  const ndContract = (await upgrades.deployProxy(
    factory,
    [
      await r1.getAddress(),
      await controller.getAddress(),
      await owner.getAddress(),
    ],
    { initializer: "initialize" }
  )) as NDContract;
  await ndContract.waitForDeployment();
  return ndContract;
}

export async function deployMNDContract({
  r1,
  controller,
  owner,
}: {
  r1: R1;
  controller: Controller;
  owner: Signer;
}): Promise<MNDContract> {
  const factory = await ethers.getContractFactory("MNDContract");
  const mndContract = (await upgrades.deployProxy(
    factory,
    [
      await r1.getAddress(),
      await controller.getAddress(),
      await owner.getAddress(),
    ],
    { initializer: "initialize" }
  )) as unknown as MNDContract;
  await mndContract.waitForDeployment();
  return mndContract;
}

export function generateInvoiceUuid(label: string = "invoice"): string {
  const data = ethers.solidityPacked(
    ["string", "uint256"],
    [label, invoiceNonce++]
  );
  return ethers.keccak256(data);
}

export async function signBuyLicense(
  signer: Signer,
  buyerAddress: string,
  invoiceUuid: BytesLike | string,
  usdMintLimit: BigNumberish,
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

export async function signLinkMultiNode(
  signer: Signer,
  user: Signer,
  nodeAddresses: string[]
): Promise<string> {
  const userAddress = await user.getAddress();
  // Must mirror Solidity: keccak256(abi.encodePacked(addr, address[]))
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "address[]"],
    [userAddress, nodeAddresses]
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
  usdMintLimit?: BigNumberish;
  invoiceUuid?: BytesLike | string;
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

  await r1.connect(mintAuthority).mint(buyerAddress, maxAccepted);
  await r1.connect(buyer).approve(await nd.getAddress(), maxAccepted);

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
  await nd.connect(buyer).linkNode(ndLicenseId, nodeAddress, linkSignature);

  return ndLicenseId;
}

type BuyLicenseWithAllowanceParams = {
  r1: R1;
  nd: NDContract;
  mintAuthority: Signer;
  buyer: Signer;
  pricePerLicense: bigint;
  licenseCount: number;
  priceTier: number;
  invoiceUuid: BytesLike | string;
  usdMintLimit: BigNumberish;
  vatPercent: number;
  signature: BytesLike | string;
};

export async function buyLicenseWithMintAndAllowance(
  params: BuyLicenseWithAllowanceParams
): Promise<bigint>;
export async function buyLicenseWithMintAndAllowance(
  r1: R1,
  nd: NDContract,
  mintAuthority: Signer,
  buyer: Signer,
  pricePerLicense: bigint,
  licenseCount: number,
  priceTier: number,
  invoiceUuid: BytesLike | string,
  usdMintLimit: BigNumberish,
  vatPercent: number,
  signature: BytesLike | string
): Promise<bigint>;
export async function buyLicenseWithMintAndAllowance(
  ...args:
    | [BuyLicenseWithAllowanceParams]
    | [
        R1,
        NDContract,
        Signer,
        Signer,
        bigint,
        number,
        number,
        BytesLike | string,
        BigNumberish,
        number,
        BytesLike | string
      ]
): Promise<bigint> {
  const {
    r1,
    nd,
    mintAuthority,
    buyer,
    pricePerLicense,
    licenseCount,
    priceTier,
    invoiceUuid,
    usdMintLimit,
    vatPercent,
    signature,
  } =
    args.length === 1
      ? args[0]
      : {
          r1: args[0],
          nd: args[1],
          mintAuthority: args[2],
          buyer: args[3],
          pricePerLicense: args[4],
          licenseCount: args[5],
          priceTier: args[6],
          invoiceUuid: args[7],
          usdMintLimit: args[8],
          vatPercent: args[9],
          signature: args[10],
        };

  const buyerAddress = await buyer.getAddress();
  const licenses = BigInt(licenseCount);
  const totalWithoutVat = pricePerLicense * licenses;
  const vatAmount = (totalWithoutVat * BigInt(vatPercent)) / 100n;
  const totalWithVat = totalWithoutVat + vatAmount;
  const maxAccepted = totalWithVat + totalWithVat / 10n;

  await r1.connect(mintAuthority).mint(buyerAddress, maxAccepted);
  await r1.connect(buyer).approve(await nd.getAddress(), maxAccepted);

  const normalizedSignature =
    typeof signature === "string"
      ? normalizeHex(signature)
      : ethers.hexlify(signature);
  const normalizedInvoiceUuid =
    typeof invoiceUuid === "string"
      ? normalizeHex(invoiceUuid)
      : ethers.hexlify(invoiceUuid);

  await nd
    .connect(buyer)
    .buyLicense(
      licenseCount,
      priceTier,
      maxAccepted,
      normalizedInvoiceUuid,
      usdMintLimit,
      vatPercent,
      ethers.getBytes(normalizedSignature)
    );

  return maxAccepted;
}

export async function linkNodeWithSignature({
  contract,
  user,
  licenseId,
  nodeAddress,
  oracleSigner,
}: {
  contract: NDContract | MNDContract;
  user: Signer;
  licenseId: number;
  nodeAddress: string;
  oracleSigner: Signer;
}): Promise<void> {
  await contract
    .connect(user)
    .linkNode(
      licenseId,
      nodeAddress,
      await signLinkNode(oracleSigner, user, nodeAddress)
    );
}

export async function linkMultiNodeWithSignature({
  contract,
  user,
  licenseIds,
  nodeAddresses,
  oracleSigner,
}: {
  contract: NDContract | MNDContract;
  user: Signer;
  licenseIds: number[];
  nodeAddresses: string[];
  oracleSigner: Signer;
}): Promise<void> {
  await contract
    .connect(user)
    .linkMultiNode(
      licenseIds,
      nodeAddresses,
      await signLinkMultiNode(oracleSigner, user, nodeAddresses)
    );
}

export async function signComputeParams({
  signer,
  nodeAddress,
  epochs,
  availabilities,
}: {
  signer: Signer;
  nodeAddress: string;
  epochs: BigNumberish[];
  availabilities: BigNumberish[];
}): Promise<string> {
  let messageBytes = Buffer.from(nodeAddress.slice(2), "hex");

  for (const epoch of epochs) {
    const epochBytes = ethers.zeroPadValue(ethers.toBeHex(epoch), 32);
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(epochBytes.slice(2), "hex"),
    ]);
  }

  for (const availability of availabilities) {
    const availabilityBytes = ethers.zeroPadValue(
      ethers.toBeHex(availability),
      32
    );
    messageBytes = Buffer.concat([
      messageBytes,
      Buffer.from(availabilityBytes.slice(2), "hex"),
    ]);
  }

  const messageHash = ethers.keccak256(messageBytes);
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  const signatureBytes = Buffer.from(signature.slice(2), "hex");

  if (signatureBytes[64] < 27) {
    signatureBytes[64] += 27;
  }

  return ethers.hexlify(signatureBytes);
}

export async function deployUniswapMocks(r1: R1): Promise<{
  usdc: ERC20Mock;
  router: UniswapMockRouter;
  pair: UniswapMockPair;
}> {
  const erc20Factory = await ethers.getContractFactory("ERC20Mock");
  const usdc = (await erc20Factory.deploy()) as ERC20Mock;
  await usdc.waitForDeployment();

  const routerFactory = await ethers.getContractFactory("UniswapMockRouter");
  const router = (await routerFactory.deploy()) as UniswapMockRouter;
  await router.waitForDeployment();

  const pairFactory = await ethers.getContractFactory("UniswapMockPair");
  const pair = (await pairFactory.deploy(
    await usdc.getAddress(),
    await r1.getAddress()
  )) as UniswapMockPair;
  await pair.waitForDeployment();

  return { usdc, router, pair };
}
