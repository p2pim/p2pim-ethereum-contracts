const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')
const P2pimMasterRecord = artifacts.require('P2pimMasterRecord')
const ERC20PresetFixedSupply = artifacts.require('@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol')

module.exports = async function (deployer, network, accounts) {
  const masterInstance = await P2pimMasterRecord.deployed()
  if (network === 'ropsten') {
    const weenus = '0x101848D5C5bBca18E6b4431eEdF6B95E9ADF82FA'
    const xeenus = '0x7E0480Ca9fD50EB7A3855Cf53c347A1b4d6A2FF5'

    await deployer.deploy(P2pimAdjudicator, weenus)
    await masterInstance.registerDeployment(weenus, P2pimAdjudicator.address)

    await deployer.deploy(P2pimAdjudicator, xeenus)
    await masterInstance.registerDeployment(xeenus, P2pimAdjudicator.address)
  } else if (network === 'development' || network === 'development_ganache_ui') {
    const p2pim = await ERC20PresetFixedSupply.new('P2pimTestERC20', 'P2PIM', '10000000000000000000000', accounts[0])

    await deployer.deploy(P2pimAdjudicator, p2pim.address)
    await masterInstance.registerDeployment(p2pim.address, P2pimAdjudicator.address)
  }
}
