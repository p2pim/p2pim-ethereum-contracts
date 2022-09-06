const P2pimAdjudicator = artifacts.require('P2pimAdjudicator');

module.exports = function (deployer, network) {
  if (network === 'ropsten') {
    const weenus = '0x101848D5C5bBca18E6b4431eEdF6B95E9ADF82FA';
    const xeenus = '0x7E0480Ca9fD50EB7A3855Cf53c347A1b4d6A2FF5';
    deployer.deploy(P2pimAdjudicator, weenus);
    deployer.deploy(P2pimAdjudicator, xeenus);
  }
};
