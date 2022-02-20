const P2pimMasterRecord = artifacts.require('P2pimMasterRecord')

require('chai')
  .use(require('chai-as-promised'))
  .should()

const { assert, expect } = require('chai')
const truffleAssert = require('truffle-assertions')

contract('P2pimMasterRecord', async accounts => {
  const mockTokenAddress = '0x5f8F7b54E5411874829a6bF4c99e122d2F6CdEf5'
  const mockTokenAddress2 = '0x31Db57e8418C90Cf674308D42b40774627E8bbD4'
  const mockAddress = '0x96B5834632ea9546bA0C990574Ba8e348603F93c'
  const mockAddress2 = '0x51BC63c835bf27Cdc79861CA74787DA7877fB6a1'

  describe('deployments', async () => {
    it('should be empty at the begining', async () => {
      const instance = await P2pimMasterRecord.new()

      const result = await instance.deployments()

      assert(result.length === 0, 'deployments() should return empty array')
    })
  })

  describe('registerDeployment', async () => {
    it('should allow register new contracts', async () => {
      const instance = await P2pimMasterRecord.new()

      const tx = await instance.registerDeployment(mockTokenAddress, mockAddress)

      truffleAssert.eventEmitted(tx, 'Deployed', (ev) => {
        return ev.token === mockTokenAddress &&
          ev.adjudicator === mockAddress
      })
      const result = await instance.deployments.call()
      assert(result.length === 1)
      assert(result[0].token === mockTokenAddress)
      assert(result[0].adjudicator === mockAddress)
    })

    it('should allow register more that one contract', async () => {
      const instance = await P2pimMasterRecord.new()

      await instance.registerDeployment(mockTokenAddress, mockAddress)
      await instance.registerDeployment(mockTokenAddress2, mockAddress2)

      const result = await instance.deployments.call()
      assert(result.length === 2)
    })

    it('should override a already deployed token', async () => {
      const instance = await P2pimMasterRecord.new()

      await instance.registerDeployment(mockTokenAddress, mockAddress)
      await instance.registerDeployment(mockTokenAddress, mockAddress2)

      const result = await instance.deployments.call()
      expect(result.length).equals(1)
      expect(result[0].token).equals(mockTokenAddress)
      expect(result[0].adjudicator).equals(mockAddress2)
    })

    it('should only allow creator to register deployments', async () => {
      const instance = await P2pimMasterRecord.new()

      await instance.registerDeployment(mockTokenAddress, mockAddress, { from: accounts[1] }).should.be.rejectedWith('Only creator can register deployments')
    })
  })
})
