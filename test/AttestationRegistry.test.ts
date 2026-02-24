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
      [owner.address, owner.address],
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
    expect(attestation.tenant).to.equal(relayer.address);
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

  it("reverts when test mode is out of range", async function () {
    const invalidTestMode = 2;
    const signature = await signAttestation(
      nodeSigner,
      invalidTestMode,
      NODE_COUNT,
      VULNERABILITY_SCORE,
      IP_OBFUSCATED,
      CID_OBFUSCATED
    );

    await expect(
      registry.submitRedmeshAttestation(
        invalidTestMode,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        signature
      )
    ).to.be.revertedWithCustomError(registry, "InvalidTestMode");
  });

  it("reverts when node signature is malformed", async function () {
    await expect(
      registry.submitRedmeshAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        "0x1234"
      )
    ).to.be.reverted;
  });

  it("accepts duplicate attestations (no uniqueness enforcement)", async function () {
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

  it("returns paginated attestations in both orders", async function () {
    const firstSig = await signAttestation(
      nodeSigner,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      10
    );
    const secondSig = await signAttestation(
      nodeSigner,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      20
    );
    const thirdSig = await signAttestation(
      nodeSigner,
      TEST_MODE_SINGLE,
      NODE_COUNT,
      30
    );

    await registry.submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      10,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      firstSig
    );
    await registry.submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      20,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      secondSig
    );
    await registry.submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      30,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      thirdSig
    );

    const forward = await registry.getRedmeshAttestations(1, 2, false);
    expect(forward.length).to.equal(2);
    expect(forward[0].vulnerabilityScore).to.equal(20);
    expect(forward[1].vulnerabilityScore).to.equal(30);

    const reverse = await registry.getRedmeshAttestations(1, 2, true);
    expect(reverse.length).to.equal(2);
    expect(reverse[0].vulnerabilityScore).to.equal(20);
    expect(reverse[1].vulnerabilityScore).to.equal(10);

    const empty = await registry.getRedmeshAttestations(10, 2, true);
    expect(empty.length).to.equal(0);
  });

  it("tracks tenant attestation indexes by submitter wallet", async function () {
    const sig10 = await signAttestation(nodeSigner, TEST_MODE_SINGLE, NODE_COUNT, 10);
    const sig20 = await signAttestation(nodeSigner, TEST_MODE_SINGLE, NODE_COUNT, 20);
    const sig30 = await signAttestation(nodeSigner, TEST_MODE_SINGLE, NODE_COUNT, 30);

    await registry.connect(relayer).submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      10,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      sig10
    );
    await registry.connect(owner).submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      20,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      sig20
    );
    await registry.connect(relayer).submitRedmeshAttestation(
      TEST_MODE_SINGLE,
      NODE_COUNT,
      30,
      IP_OBFUSCATED,
      CID_OBFUSCATED,
      sig30
    );

    expect(await registry.getTenantRedmeshAttestationIndexCount(relayer.address)).to.equal(2);
    expect(await registry.getTenantRedmeshAttestationIndexCount(owner.address)).to.equal(1);
    expect(await registry.getTenantRedmeshAttestationIndexCount(other.address)).to.equal(0);

    const relayerForward = await registry.getTenantRedmeshAttestationIndexes(
      relayer.address,
      0,
      10,
      false
    );
    expect(relayerForward.length).to.equal(2);
    expect(relayerForward[0]).to.equal(0);
    expect(relayerForward[1]).to.equal(2);

    const relayerReverse = await registry.getTenantRedmeshAttestationIndexes(
      relayer.address,
      0,
      10,
      true
    );
    expect(relayerReverse.length).to.equal(2);
    expect(relayerReverse[0]).to.equal(2);
    expect(relayerReverse[1]).to.equal(0);

    const ownerAttestation = await registry.getRedmeshAttestation(1);
    expect(ownerAttestation.tenant).to.equal(owner.address);
  });

  it("reverts initialize for zero addresses", async function () {
    const factory = await ethers.getContractFactory("AttestationRegistry");
    await expect(
      upgrades.deployProxy(
        factory,
        [ethers.ZeroAddress, owner.address],
        { initializer: "initialize" }
      )
    ).to.be.revertedWithCustomError(
      factory,
      "InvalidAddress"
    );

    await expect(
      upgrades.deployProxy(
        factory,
        [owner.address, ethers.ZeroAddress],
        { initializer: "initialize" }
      )
    ).to.be.revertedWithCustomError(
      factory,
      "InvalidAddress"
    );
  });
});
