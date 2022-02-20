const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')
const P2pimMasterRecord = artifacts.require('P2pimMasterRecord')

module.exports = async function (deployer, network) {
  if (network === 'ropsten') {
    const weenus = '0x101848D5C5bBca18E6b4431eEdF6B95E9ADF82FA'
    const xeenus = '0x7E0480Ca9fD50EB7A3855Cf53c347A1b4d6A2FF5'
    const masterInstance = await P2pimMasterRecord.deployed()
    
    await deployer.deploy(P2pimAdjudicator, weenus)
    await masterInstance.registerDeployment(weenus, P2pimAdjudicator.address)
    
    await deployer.deploy(P2pimAdjudicator, xeenus)
    await masterInstance.registerDeployment(xeenus, P2pimAdjudicator.address)
  }
}
