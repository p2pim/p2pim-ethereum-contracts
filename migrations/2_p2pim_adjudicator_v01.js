const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')

module.exports = function (deployer) {
  deployer.deploy(P2pimAdjudicator)
}
