import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { AttestationRegistry } from "../typechain-types";

describe("AttestationRegistry", function () {
  let registry: AttestationRegistry;
  let owner: HardhatEthersSigner;
  let nodeSigner: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("RATIO1_ATTESTATION_V1"));
  const APP_ID = ethers.keccak256(ethers.toUtf8Bytes("redmesh"));
  const TEST_MODE_SINGLE = 0;
  const NODE_COUNT = 3;
  const VULNERABILITY_SCORE = 74;
  const IP_OBFUSCATED = "0x863a"; // 134..58
  const CID_OBFUSCATED = "0x61626364657576777879"; // abcdeuvwxy
  const CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("cid:bafybeigdyr"));

  async function deployRegistry(): Promise<AttestationRegistry> {
    const factory = await ethers.getContractFactory("AttestationRegistry");
    const contract = await upgrades.deployProxy(
      factory,
      [owner.address, owner.address, false],
      { initializer: "initialize" }
    );
    await contract.waitForDeployment();
    return contract as unknown as AttestationRegistry;
  }

  function buildDigest(
    appId: string,
    testMode: number,
    nodeCount: number,
    vulnerabilityScore: number,
    ipObfuscated: string,
    cidObfuscated: string,
    contentHash: string
  ): string {
    return ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32", "uint8", "uint16", "uint8", "bytes2", "bytes10", "bytes32"],
      [
        DOMAIN,
        appId,
        testMode,
        nodeCount,
        vulnerabilityScore,
        ipObfuscated,
        cidObfuscated,
        contentHash,
      ]
    );
  }

  async function signAttestation(
    signer: HardhatEthersSigner,
    appId = APP_ID,
    testMode = TEST_MODE_SINGLE,
    nodeCount = NODE_COUNT,
    vulnerabilityScore = VULNERABILITY_SCORE,
    ipObfuscated = IP_OBFUSCATED,
    cidObfuscated = CID_OBFUSCATED,
    contentHash = CONTENT_HASH
  ): Promise<string> {
    const digest = buildDigest(
      appId,
      testMode,
      nodeCount,
      vulnerabilityScore,
      ipObfuscated,
      cidObfuscated,
      contentHash
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  beforeEach(async function () {
    [owner, nodeSigner, relayer, other] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  it("stores attestation using recovered node signer even when tx sender differs", async function () {
    await registry.connect(owner).setNodeWhitelistEnforced(true);
    await registry.connect(owner).setNodeAllowed(nodeSigner.address, true);

    const signature = await signAttestation(nodeSigner);
    const expectedDigest = buildDigest(
      APP_ID,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      CONTENT_HASH
    );
    expect(
      await registry.getAttestationDigest(
        APP_ID,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        CONTENT_HASH
      )
    ).to.equal(expectedDigest);

    await expect(
      registry
        .connect(relayer)
        .submitAttestation(
          APP_ID,
          TEST_MODE_SINGLE,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          CONTENT_HASH,
          signature
        )
    )
      .to.emit(registry, "AttestationStored")
      .withArgs(
        APP_ID,
        0,
        nodeSigner.address,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        CONTENT_HASH,
        relayer.address
      );

    expect(await registry.getAttestationCount(APP_ID)).to.equal(1);
    const attestation = await registry.getAttestation(APP_ID, 0);
    expect(attestation.node).to.equal(nodeSigner.address);
    expect(attestation.nodeCount).to.equal(NODE_COUNT);
    expect(attestation.vulnerabilityScore).to.equal(VULNERABILITY_SCORE);
    expect(attestation.testMode).to.equal(TEST_MODE_SINGLE);
    expect(attestation.ipObfuscated).to.equal(IP_OBFUSCATED);
    expect(attestation.cidObfuscated).to.equal(CID_OBFUSCATED);
    expect(attestation.contentHash).to.equal(CONTENT_HASH);
  });

  it("reverts when vulnerability score exceeds 100", async function () {
    const signature = await signAttestation(
      nodeSigner,
      APP_ID,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      101,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      CONTENT_HASH
    );

    await expect(
      registry.submitAttestation(
        APP_ID,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        101,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        CONTENT_HASH,
        signature
      )
    ).to.be.revertedWithCustomError(registry, "InvalidVulnerabilityScore");
  });

  it("enforces node whitelist when enabled", async function () {
    await registry.connect(owner).setNodeWhitelistEnforced(true);
    const signature = await signAttestation(nodeSigner);

    await expect(
      registry.submitAttestation(
        APP_ID,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        CONTENT_HASH,
        signature
      )
    )
      .to.be.revertedWithCustomError(registry, "NodeNotAllowed")
      .withArgs(nodeSigner.address);
  });

  it("accepts duplicate attestations (no uniqueness enforcement)", async function () {
    await registry.connect(owner).setNodeWhitelistEnforced(true);
    await registry.connect(owner).setNodeAllowed(nodeSigner.address, true);

    const signature = await signAttestation(nodeSigner);
    await registry.submitAttestation(
      APP_ID,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      CONTENT_HASH,
      signature
    );
    await registry.submitAttestation(
      APP_ID,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      CONTENT_HASH,
      signature
    );

    expect(await registry.getAttestationCount(APP_ID)).to.equal(2);
  });

  it("only owner can manage PoAI manager and node whitelist settings", async function () {
    await expect(
      registry.connect(other).setPoaiManager(other.address)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    await expect(
      registry.connect(other).setNodeWhitelistEnforced(true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    await expect(
      registry.connect(other).setNodeAllowed(nodeSigner.address, true)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    await registry.connect(owner).setPoaiManager(other.address);
    expect(await registry.poaiManager()).to.equal(other.address);
  });
});
