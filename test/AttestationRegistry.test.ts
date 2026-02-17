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

  const DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("RATIO1_REDMESH_ATTESTATION_V1"));
  const TEST_MODE_SINGLE = 0;
  const NODE_COUNT = 3;
  const VULNERABILITY_SCORE = 74;
  const IP_OBFUSCATED = "0x863a"; // 134..58
  const CID_OBFUSCATED = "0x61626364657576777879"; // abcdeuvwxy

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
    testMode: number,
    nodeCount: number,
    vulnerabilityScore: number,
    ipObfuscated: string,
    cidObfuscated: string
  ): string {
    return ethers.solidityPackedKeccak256(
      ["bytes32", "uint8", "uint16", "uint8", "bytes2", "bytes10"],
      [
        DOMAIN,
        testMode,
        nodeCount,
        vulnerabilityScore,
        ipObfuscated,
        cidObfuscated,
      ]
    );
  }

  async function signAttestation(
    signer: HardhatEthersSigner,
    testMode = TEST_MODE_SINGLE,
    nodeCount = NODE_COUNT,
    vulnerabilityScore = VULNERABILITY_SCORE,
    ipObfuscated = IP_OBFUSCATED,
    cidObfuscated = CID_OBFUSCATED
  ): Promise<string> {
    const digest = buildDigest(
      testMode,
      nodeCount,
      vulnerabilityScore,
      ipObfuscated,
      cidObfuscated
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
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED
    );
    expect(
      await registry.getRedmeshAttestationDigest(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED
      )
    ).to.equal(expectedDigest);

    await expect(
      registry
        .connect(relayer)
        .submitRedmeshAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          signature
        )
    )
      .to.emit(registry, "RedmeshAttestationStored")
      .withArgs(
        0,
        nodeSigner.address,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        relayer.address
      );

    expect(await registry.getRedmeshAttestationCount()).to.equal(1);
    const attestation = await registry.getRedmeshAttestation(0);
    expect(attestation.node).to.equal(nodeSigner.address);
    expect(attestation.nodeCount).to.equal(NODE_COUNT);
    expect(attestation.vulnerabilityScore).to.equal(VULNERABILITY_SCORE);
    expect(attestation.testMode).to.equal(TEST_MODE_SINGLE);
    expect(attestation.ipObfuscated).to.equal(IP_OBFUSCATED);
    expect(attestation.cidObfuscated).to.equal(CID_OBFUSCATED);
  });

  it("reverts when vulnerability score exceeds 100", async function () {
    const signature = await signAttestation(
      nodeSigner,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      101,
      IP_OBFUSCATED,
      CID_OBFUSCATED
    );

    await expect(
      registry.submitRedmeshAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        101,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        signature
      )
    ).to.be.revertedWithCustomError(registry, "InvalidVulnerabilityScore");
  });

  it("enforces node whitelist when enabled", async function () {
    await registry.connect(owner).setNodeWhitelistEnforced(true);
    const signature = await signAttestation(nodeSigner);

    await expect(
      registry.submitRedmeshAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
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
    await registry.submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      signature
    );
    await registry.submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      signature
    );

    expect(await registry.getRedmeshAttestationCount()).to.equal(2);
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
