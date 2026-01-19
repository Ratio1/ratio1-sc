import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";
import { AdoptionOracle } from "../typechain-types";

describe("AdoptionOracle", function () {
  let owner: Signer;
  let other: Signer;
  let nd: Signer;
  let poai: Signer;
  let adoptionOracle: AdoptionOracle;

  beforeEach(async function () {
    [owner, other, nd, poai] = await ethers.getSigners();
    const AdoptionOracleFactory = await ethers.getContractFactory(
      "AdoptionOracle"
    );
    adoptionOracle = await upgrades.deployProxy(
      AdoptionOracleFactory,
      [
        await owner.getAddress(),
        await nd.getAddress(),
        await poai.getAddress(),
      ],
      { initializer: "initialize" }
    );
    await adoptionOracle.waitForDeployment();
  });

  describe("initialization", function () {
    it("accepts empty arrays and keeps totals at zero", async function () {
      await adoptionOracle.initializePoaiVolumes([], []);
      await adoptionOracle.initializeLicenseSales([], []);

      expect(await adoptionOracle.totalPoaiVolume()).to.equal(0n);
      expect(await adoptionOracle.totalLicensesSold()).to.equal(0n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(5)).to.equal(0n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(5)).to.equal(0n);
    });

    it("initializes PoAI volume checkpoints and totals", async function () {
      const epochs = [1, 3, 5];
      const totals = [10n, 20n, 30n];

      await adoptionOracle.initializePoaiVolumes(epochs, totals);

      expect(await adoptionOracle.totalPoaiVolume()).to.equal(30n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(0)).to.equal(0n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(1)).to.equal(10n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(2)).to.equal(10n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(4)).to.equal(20n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(6)).to.equal(30n);
    });

    it("initializes license sales checkpoints and totals", async function () {
      const epochs = [2, 4];
      const totals = [5n, 9n];

      await adoptionOracle.initializeLicenseSales(epochs, totals);

      expect(await adoptionOracle.totalLicensesSold()).to.equal(9n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(1)).to.equal(0n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(2)).to.equal(5n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(3)).to.equal(5n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(5)).to.equal(9n);
    });

    it("reverts for non-owner and invalid input", async function () {
      await expect(
        adoptionOracle.connect(other).initializePoaiVolumes([1], [1n])
      )
        .to.be.revertedWithCustomError(
          adoptionOracle,
          "OwnableUnauthorizedAccount"
        )
        .withArgs(await other.getAddress());

      await expect(
        adoptionOracle.initializeLicenseSales([1, 1], [1n, 2n])
      ).to.be.revertedWith("Epochs not increasing");

      await expect(
        adoptionOracle.initializePoaiVolumes([1], [1n, 2n])
      ).to.be.revertedWith("Length mismatch");

      await expect(
        adoptionOracle.initializePoaiVolumes([1, 2], [5n, 4n])
      ).to.be.revertedWith("Totals not increasing");
    });

    it("reverts when initializing after values exist", async function () {
      await adoptionOracle.initializePoaiVolumes([1], [10n]);

      await expect(
        adoptionOracle.initializePoaiVolumes([2], [20n])
      ).to.be.revertedWith("PoAI volumes already set");
    });
  });

  describe("recordLicenseSales", function () {
    it("requires ND and ignores zero amounts", async function () {
      await expect(adoptionOracle.recordLicenseSales(1, 1)).to.be.revertedWith(
        "Not ND contract"
      );

      await adoptionOracle.connect(nd).recordLicenseSales(1, 0);

      expect(await adoptionOracle.totalLicensesSold()).to.equal(0n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(1)).to.equal(0n);
    });

    it("records totals for new epochs and updates same epoch", async function () {
      await adoptionOracle.connect(nd).recordLicenseSales(5, 10);
      expect(await adoptionOracle.totalLicensesSold()).to.equal(10n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(5)).to.equal(10n);

      await adoptionOracle.connect(nd).recordLicenseSales(5, 5);
      expect(await adoptionOracle.totalLicensesSold()).to.equal(15n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(5)).to.equal(15n);

      await adoptionOracle.connect(nd).recordLicenseSales(6, 2);
      expect(await adoptionOracle.totalLicensesSold()).to.equal(17n);

      const range = await adoptionOracle.getLicensesSoldRange(5, 6);
      expect(range).to.deep.equal([15n, 17n]);
    });

    it("continues after initialized totals", async function () {
      await adoptionOracle.initializeLicenseSales([2], [7n]);

      await adoptionOracle.connect(nd).recordLicenseSales(3, 4);

      expect(await adoptionOracle.totalLicensesSold()).to.equal(11n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(2)).to.equal(7n);
      expect(await adoptionOracle.getLicensesSoldAtEpoch(3)).to.equal(11n);
    });

    it("reverts when epochs go backwards", async function () {
      await adoptionOracle.connect(nd).recordLicenseSales(3, 1);

      await expect(
        adoptionOracle.connect(nd).recordLicenseSales(2, 1)
      ).to.be.revertedWith("Invalid epoch order");
    });
  });

  describe("recordPoaiVolume", function () {
    it("requires PoAI manager and ignores zero amounts", async function () {
      await expect(adoptionOracle.recordPoaiVolume(1, 1)).to.be.revertedWith(
        "Not PoAI Manager"
      );

      await adoptionOracle.connect(poai).recordPoaiVolume(1, 0);

      expect(await adoptionOracle.totalPoaiVolume()).to.equal(0n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(1)).to.equal(0n);
    });

    it("records totals for new epochs and updates same epoch", async function () {
      await adoptionOracle.connect(poai).recordPoaiVolume(4, 100);
      expect(await adoptionOracle.totalPoaiVolume()).to.equal(100n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(4)).to.equal(100n);

      await adoptionOracle.connect(poai).recordPoaiVolume(4, 50);
      expect(await adoptionOracle.totalPoaiVolume()).to.equal(150n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(4)).to.equal(150n);

      await adoptionOracle.connect(poai).recordPoaiVolume(5, 25);
      expect(await adoptionOracle.totalPoaiVolume()).to.equal(175n);

      const range = await adoptionOracle.getPoaiVolumeRange(4, 5);
      expect(range).to.deep.equal([150n, 175n]);
    });

    it("continues after initialized totals", async function () {
      await adoptionOracle.initializePoaiVolumes([1], [100n]);

      await adoptionOracle.connect(poai).recordPoaiVolume(2, 30);

      expect(await adoptionOracle.totalPoaiVolume()).to.equal(130n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(1)).to.equal(100n);
      expect(await adoptionOracle.getPoaiVolumeAtEpoch(2)).to.equal(130n);
    });

    it("reverts when epochs go backwards", async function () {
      await adoptionOracle.connect(poai).recordPoaiVolume(3, 1);

      await expect(
        adoptionOracle.connect(poai).recordPoaiVolume(2, 1)
      ).to.be.revertedWith("Invalid epoch order");
    });
  });

  describe("range queries", function () {
    it("returns zero-filled ranges when no checkpoints exist", async function () {
      const licenseRange = await adoptionOracle.getLicensesSoldRange(1, 3);
      const poaiRange = await adoptionOracle.getPoaiVolumeRange(1, 3);

      expect(licenseRange).to.deep.equal([0n, 0n, 0n]);
      expect(poaiRange).to.deep.equal([0n, 0n, 0n]);
    });

    it("fills ranges using the latest checkpoint", async function () {
      await adoptionOracle.connect(nd).recordLicenseSales(2, 10);
      await adoptionOracle.connect(nd).recordLicenseSales(5, 5);

      const range = await adoptionOracle.getLicensesSoldRange(1, 6);
      expect(range).to.deep.equal([0n, 10n, 10n, 10n, 15n, 15n]);
    });

    it("reverts on invalid range bounds", async function () {
      await expect(
        adoptionOracle.getLicensesSoldRange(3, 1)
      ).to.be.revertedWith("Invalid epoch range");
    });
  });
});
