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

  const DOMAIN = ethers.keccak256(
    ethers.toUtf8Bytes("RATIO1_REDMESH_ATTESTATION_V1")
  );

  const TEST_MODE_SINGLE = 0;
  const TEST_MODE_CONTINUOUS = 1;

  const NODE_COUNT = 3;
  const VULNERABILITY_SCORE = 74;
  const EXECUTION_ID = "0x6a6f623030303031"; // job00001
  const IP_OBFUSCATED = "0x863a"; // 134..58
  const CID_OBFUSCATED = "0x61626364657576777879"; // abcdeuvwxy
  const NODE_HASHES = ethers.keccak256(ethers.toUtf8Bytes("nodes-v1"));

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

  function buildTestDigest(
    testMode: number,
    nodeCount: number,
    vulnerabilityScore: number,
    executionId: string,
    ipObfuscated: string,
    cidObfuscated: string
  ): string {
    return ethers.solidityPackedKeccak256(
      ["bytes32", "uint8", "uint16", "uint8", "bytes8", "bytes2", "bytes10"],
      [
        DOMAIN,
        testMode,
        nodeCount,
        vulnerabilityScore,
        executionId,
        ipObfuscated,
        cidObfuscated,
      ]
    );
  }

  function buildJobStartDigest(
    testMode: number,
    nodeCount: number,
    executionId: string,
    nodeHashes: string,
    ipObfuscated: string
  ): string {
    return ethers.solidityPackedKeccak256(
      ["bytes32", "uint8", "uint16", "bytes8", "bytes32", "bytes2"],
      [DOMAIN, testMode, nodeCount, executionId, nodeHashes, ipObfuscated]
    );
  }

  async function signTestAttestation(
    signer: HardhatEthersSigner,
    testMode = TEST_MODE_SINGLE,
    nodeCount = NODE_COUNT,
    vulnerabilityScore = VULNERABILITY_SCORE,
    executionId = EXECUTION_ID,
    ipObfuscated = IP_OBFUSCATED,
    cidObfuscated = CID_OBFUSCATED
  ): Promise<string> {
    const digest = buildTestDigest(
      testMode,
      nodeCount,
      vulnerabilityScore,
      executionId,
      ipObfuscated,
      cidObfuscated
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  async function signJobStartAttestation(
    signer: HardhatEthersSigner,
    testMode = TEST_MODE_SINGLE,
    nodeCount = NODE_COUNT,
    executionId = EXECUTION_ID,
    nodeHashes = NODE_HASHES,
    ipObfuscated = IP_OBFUSCATED
  ): Promise<string> {
    const digest = buildJobStartDigest(
      testMode,
      nodeCount,
      executionId,
      nodeHashes,
      ipObfuscated
    );
    return signer.signMessage(ethers.getBytes(digest));
  }

  beforeEach(async function () {
    [owner, nodeSigner, relayer, other] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  describe("RedmeshTestAttestation", function () {
    it("stores test attestation using recovered node signer even when tx sender differs", async function () {
      const signature = await signTestAttestation(nodeSigner);
      const expectedDigest = buildTestDigest(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED
      );
      expect(
        await registry.getRedmeshTestAttestationDigest(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED
        )
      ).to.equal(expectedDigest);

      await expect(
        registry
          .connect(relayer)
          .submitRedmeshTestAttestation(
            TEST_MODE_SINGLE,
            NODE_COUNT,
            VULNERABILITY_SCORE,
            EXECUTION_ID,
            IP_OBFUSCATED,
            CID_OBFUSCATED,
            signature
          )
      )
        .to.emit(registry, "RedmeshTestAttestationStored")
        .withArgs(
          0,
          nodeSigner.address,
          TEST_MODE_SINGLE,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          relayer.address
        );

      expect(await registry.getRedmeshTestAttestationCount()).to.equal(1);
      const attestation = await registry.getRedmeshTestAttestation(0);
      expect(attestation.node).to.equal(nodeSigner.address);
      expect(attestation.nodeCount).to.equal(NODE_COUNT);
      expect(attestation.vulnerabilityScore).to.equal(VULNERABILITY_SCORE);
      expect(attestation.testMode).to.equal(TEST_MODE_SINGLE);
      expect(attestation.executionId).to.equal(EXECUTION_ID);
      expect(attestation.ipObfuscated).to.equal(IP_OBFUSCATED);
      expect(attestation.cidObfuscated).to.equal(CID_OBFUSCATED);
      expect(attestation.tenant).to.equal(relayer.address);
    });

    it("reverts when vulnerability score exceeds 100", async function () {
      const signature = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        101,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED
      );

      await expect(
        registry.submitRedmeshTestAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          101,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          signature
        )
      ).to.be.revertedWithCustomError(registry, "InvalidVulnerabilityScore");
    });

    it("reverts when test mode is out of range", async function () {
      const invalidTestMode = 2;
      const signature = await signTestAttestation(
        nodeSigner,
        invalidTestMode,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED
      );

      await expect(
        registry.submitRedmeshTestAttestation(
          invalidTestMode,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          signature
        )
      ).to.be.revertedWithCustomError(registry, "InvalidTestMode");
    });

    it("reverts when node signature is malformed", async function () {
      await expect(
        registry.submitRedmeshTestAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          VULNERABILITY_SCORE,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          "0x1234"
        )
      ).to.be.reverted;
    });

    it("accepts duplicate test attestations", async function () {
      const signature = await signTestAttestation(nodeSigner);
      await registry.submitRedmeshTestAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        signature
      );
      await registry.submitRedmeshTestAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        VULNERABILITY_SCORE,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        signature
      );

      expect(await registry.getRedmeshTestAttestationCount()).to.equal(2);
    });

    it("returns paginated test attestations in both orders", async function () {
      const firstSig = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        10
      );
      const secondSig = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        20
      );
      const thirdSig = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        30
      );

      await registry.submitRedmeshTestAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        10,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        firstSig
      );
      await registry.submitRedmeshTestAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        20,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        secondSig
      );
      await registry.submitRedmeshTestAttestation(
        TEST_MODE_SINGLE,
        NODE_COUNT,
        30,
        EXECUTION_ID,
        IP_OBFUSCATED,
        CID_OBFUSCATED,
        thirdSig
      );

      const forward = await registry.getRedmeshTestAttestations(1, 2, false);
      expect(forward.length).to.equal(2);
      expect(forward[0].vulnerabilityScore).to.equal(20);
      expect(forward[1].vulnerabilityScore).to.equal(30);

      const reverse = await registry.getRedmeshTestAttestations(1, 2, true);
      expect(reverse.length).to.equal(2);
      expect(reverse[0].vulnerabilityScore).to.equal(20);
      expect(reverse[1].vulnerabilityScore).to.equal(10);

      const empty = await registry.getRedmeshTestAttestations(10, 2, true);
      expect(empty.length).to.equal(0);
    });

    it("tracks tenant test attestation indexes by submitter wallet", async function () {
      const sig10 = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        10
      );
      const sig20 = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        20
      );
      const sig30 = await signTestAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        30
      );

      await registry
        .connect(relayer)
        .submitRedmeshTestAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          10,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          sig10
        );
      await registry
        .connect(owner)
        .submitRedmeshTestAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          20,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          sig20
        );
      await registry
        .connect(relayer)
        .submitRedmeshTestAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          30,
          EXECUTION_ID,
          IP_OBFUSCATED,
          CID_OBFUSCATED,
          sig30
        );

      expect(
        await registry.getTenantRedmeshTestAttestationIndexCount(
          relayer.address
        )
      ).to.equal(2);
      expect(
        await registry.getTenantRedmeshTestAttestationIndexCount(owner.address)
      ).to.equal(1);
      expect(
        await registry.getTenantRedmeshTestAttestationIndexCount(other.address)
      ).to.equal(0);

      const relayerForward =
        await registry.getTenantRedmeshTestAttestationIndexes(
          relayer.address,
          0,
          10,
          false
        );
      expect(relayerForward.length).to.equal(2);
      expect(relayerForward[0]).to.equal(0);
      expect(relayerForward[1]).to.equal(2);

      const relayerReverse =
        await registry.getTenantRedmeshTestAttestationIndexes(
          relayer.address,
          0,
          10,
          true
        );
      expect(relayerReverse.length).to.equal(2);
      expect(relayerReverse[0]).to.equal(2);
      expect(relayerReverse[1]).to.equal(0);

      const ownerAttestation = await registry.getRedmeshTestAttestation(1);
      expect(ownerAttestation.tenant).to.equal(owner.address);
    });
  });

  describe("RedmeshJobStartAttestation", function () {
    it("stores job-start attestation using recovered node signer even when tx sender differs", async function () {
      const signature = await signJobStartAttestation(
        nodeSigner,
        TEST_MODE_CONTINUOUS,
        NODE_COUNT,
        EXECUTION_ID,
        NODE_HASHES,
        IP_OBFUSCATED
      );
      const expectedDigest = buildJobStartDigest(
        TEST_MODE_CONTINUOUS,
        NODE_COUNT,
        EXECUTION_ID,
        NODE_HASHES,
        IP_OBFUSCATED
      );
      expect(
        await registry.getRedmeshJobStartAttestationDigest(
          TEST_MODE_CONTINUOUS,
          NODE_COUNT,
          EXECUTION_ID,
          NODE_HASHES,
          IP_OBFUSCATED
        )
      ).to.equal(expectedDigest);

      await expect(
        registry
          .connect(relayer)
          .submitRedmeshJobStartAttestation(
            TEST_MODE_CONTINUOUS,
            NODE_COUNT,
            EXECUTION_ID,
            NODE_HASHES,
            IP_OBFUSCATED,
            signature
          )
      )
        .to.emit(registry, "RedmeshJobStartAttestationStored")
        .withArgs(
          0,
          nodeSigner.address,
          TEST_MODE_CONTINUOUS,
          NODE_COUNT,
          EXECUTION_ID,
          NODE_HASHES,
          IP_OBFUSCATED,
          relayer.address
        );

      expect(await registry.getRedmeshJobStartAttestationCount()).to.equal(1);
      const attestation = await registry.getRedmeshJobStartAttestation(0);
      expect(attestation.node).to.equal(nodeSigner.address);
      expect(attestation.testMode).to.equal(TEST_MODE_CONTINUOUS);
      expect(attestation.nodeCount).to.equal(NODE_COUNT);
      expect(attestation.executionId).to.equal(EXECUTION_ID);
      expect(attestation.nodeHashes).to.equal(NODE_HASHES);
      expect(attestation.ipObfuscated).to.equal(IP_OBFUSCATED);
      expect(attestation.tenant).to.equal(relayer.address);
    });

    it("reverts when job-start test mode is out of range", async function () {
      const invalidTestMode = 2;
      const signature = await signJobStartAttestation(
        nodeSigner,
        invalidTestMode,
        NODE_COUNT,
        EXECUTION_ID,
        NODE_HASHES,
        IP_OBFUSCATED
      );

      await expect(
        registry.submitRedmeshJobStartAttestation(
          invalidTestMode,
          NODE_COUNT,
          EXECUTION_ID,
          NODE_HASHES,
          IP_OBFUSCATED,
          signature
        )
      ).to.be.revertedWithCustomError(registry, "InvalidTestMode");
    });

    it("reverts when job-start signature is malformed", async function () {
      await expect(
        registry.submitRedmeshJobStartAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          EXECUTION_ID,
          NODE_HASHES,
          IP_OBFUSCATED,
          "0x1234"
        )
      ).to.be.reverted;
    });

    it("tracks tenant job-start attestation indexes by submitter wallet", async function () {
      const h1 = ethers.keccak256(ethers.toUtf8Bytes("nodes1"));
      const h2 = ethers.keccak256(ethers.toUtf8Bytes("nodes2"));
      const h3 = ethers.keccak256(ethers.toUtf8Bytes("nodes3"));
      const s1 = await signJobStartAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        EXECUTION_ID,
        h1,
        IP_OBFUSCATED
      );
      const s2 = await signJobStartAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        EXECUTION_ID,
        h2,
        IP_OBFUSCATED
      );
      const s3 = await signJobStartAttestation(
        nodeSigner,
        TEST_MODE_SINGLE,
        NODE_COUNT,
        EXECUTION_ID,
        h3,
        IP_OBFUSCATED
      );

      await registry
        .connect(relayer)
        .submitRedmeshJobStartAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          EXECUTION_ID,
          h1,
          IP_OBFUSCATED,
          s1
        );
      await registry
        .connect(owner)
        .submitRedmeshJobStartAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          EXECUTION_ID,
          h2,
          IP_OBFUSCATED,
          s2
        );
      await registry
        .connect(relayer)
        .submitRedmeshJobStartAttestation(
          TEST_MODE_SINGLE,
          NODE_COUNT,
          EXECUTION_ID,
          h3,
          IP_OBFUSCATED,
          s3
        );

      expect(
        await registry.getTenantRedmeshJobStartAttestationIndexCount(
          relayer.address
        )
      ).to.equal(2);
      expect(
        await registry.getTenantRedmeshJobStartAttestationIndexCount(
          owner.address
        )
      ).to.equal(1);
      expect(
        await registry.getTenantRedmeshJobStartAttestationIndexCount(
          other.address
        )
      ).to.equal(0);

      const relayerForward =
        await registry.getTenantRedmeshJobStartAttestationIndexes(
          relayer.address,
          0,
          10,
          false
        );
      expect(relayerForward.length).to.equal(2);
      expect(relayerForward[0]).to.equal(0);
      expect(relayerForward[1]).to.equal(2);

      const relayerReverse =
        await registry.getTenantRedmeshJobStartAttestationIndexes(
          relayer.address,
          0,
          10,
          true
        );
      expect(relayerReverse.length).to.equal(2);
      expect(relayerReverse[0]).to.equal(2);
      expect(relayerReverse[1]).to.equal(0);

      const ownerAttestation = await registry.getRedmeshJobStartAttestation(1);
      expect(ownerAttestation.tenant).to.equal(owner.address);
    });
  });

  it("reverts initialize for zero addresses", async function () {
    const factory = await ethers.getContractFactory("AttestationRegistry");
    await expect(
      upgrades.deployProxy(factory, [ethers.ZeroAddress, owner.address], {
        initializer: "initialize",
      })
    ).to.be.revertedWithCustomError(factory, "InvalidAddress");

    await expect(
      upgrades.deployProxy(factory, [owner.address, ethers.ZeroAddress], {
        initializer: "initialize",
      })
    ).to.be.revertedWithCustomError(factory, "InvalidAddress");
  });
});
