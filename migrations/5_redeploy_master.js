const P2pimMasterRecord = artifacts.require('P2pimMasterRecord');

module.exports = async function (deployer, network) {
  await deployer.deploy(P2pimMasterRecord);
  await P2pimMasterRecord.deployed();
};
