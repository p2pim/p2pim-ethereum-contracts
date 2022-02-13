const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')
const P2pimTestERC20 = artifacts.require('P2pimTestERC20')

require('chai')
  .use(require('chai-as-promised'))
  .should()

const truffleAssert = require('truffle-assertions')

contract('P2pimAdjudicator', async accounts => {
  const mockTokenAddress = '0x5f8f7b54e5411874829a6bf4c99e122d2f6cdef5'

  describe('deposit', async () => {
    it('should not allow 0', async () => {
      const instance = await P2pimAdjudicator.new(mockTokenAddress)
      await instance.deposit(0, accounts[0]).should.be.rejectedWith('Incorrect amount for deposit')
    })

    it('should allow to transfer assets', async () => {
      const initialSupply = 100
      const allowance = 99999
      const transferAmount = 10

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      await erc20.approve(instance.address, allowance)

      const tx = await instance.deposit(transferAmount, accounts[0])

      truffleAssert.eventEmitted(tx, 'Deposited', (ev) => {
        return ev.user === accounts[0] &&
          ev.amount.toNumber() === transferAmount
      })
    })

    it('should fail if not enough assets', async () => {
      const initialSupply = 10
      const allowance = 99999
      const transferAmount = 11

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      await erc20.approve(instance.address, allowance)
      await instance.deposit(transferAmount, accounts[0]).should.be.rejectedWith('transfer amount exceeds balance')
    })
  })
  describe('withdraw', async () => {
    it('should not allow 0', async () => {
      const instance = await P2pimAdjudicator.new(mockTokenAddress)
      await instance.withdraw(0, accounts[0]).should.be.rejectedWith('Incorrect amount for withdraw')
    })

    it('should allow to withdraw holdings', async () => {
      const initialSupply = 100
      const allowance = 99999
      const transferAmount = 10

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, accounts[0])

      const withdrawTx = await instance.withdraw(transferAmount, accounts[1])

      truffleAssert.eventEmitted(withdrawTx, 'Withdrawn', (ev) => {
        return ev.user === accounts[0] &&
          ev.amount.toNumber() === transferAmount
      })
    })

    it('should not allow to withdraw more than deposited', async () => {
      const initialSupply = 100
      const allowance = 99999
      const transferAmount = 10
      const withdrawAmount = transferAmount + 1

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, accounts[0])

      await instance.withdraw(withdrawAmount, accounts[1]).should.be.rejectedWith('Not enough holdings')
    })
  })
})
