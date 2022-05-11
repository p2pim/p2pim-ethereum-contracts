const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')
const P2pimTestERC20 = artifacts.require('P2pimTestERC20')

require('chai')
  .use(require('chai-as-promised'))
  .should()

const { expect } = require('chai')
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
  describe('balance', async () => {
    it('should return 0 when no deposits', async () => {
      const initialSupply = 100

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      const balance = await instance.balance.call(accounts[0])
      expect(balance.available).to.equal('0')
    })
    it('should return the deposited value', async () => {
      const initialSupply = 100
      const allowance = 99999
      const transferAmount = 10
      const withdrawAmount = transferAmount - 3

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, accounts[0])
      await instance.withdraw(withdrawAmount, accounts[0])

      const balance = await instance.balance.call(accounts[0])
      expect(balance.available).to.equal('3')
    })
    it('should have into account rents', async () => {
      const initialSupply = 100000000
      const allowance = 100000000
      const transferAmount = 99999

      const web3 = P2pimAdjudicator.web3

      const erc20 = await P2pimTestERC20.new('P2pimTestERC20', 'P2PIM', initialSupply, accounts[0])
      const instance = await P2pimAdjudicator.new(erc20.address)

      const lessee = accounts[1]
      const lessor = accounts[2]
      await erc20.approve(instance.address, allowance)
      await instance.deposit(transferAmount, lessee)
      await instance.deposit(transferAmount, lessor)

      const leaseDeal = {
        lessee: lessee,
        lessor: lessor,
        nonce: Math.round(Math.random() * Number.MAX_SAFE_INTEGER),
        merkleRoot: web3.utils.keccak256('test'),
        sizeBytes: 5,
        price: 10000,
        penalty: 500,
        leaseDuration: 86400,
        lastValidSealTs: Date.now() + 100000
      }

      const abiEncoded = web3.eth.abi.encodeParameters(
        ['address',
          {
            ParentStruct: {
              lessee: 'address',
              lessor: 'address',
              nonce: 'uint64',
              merkleRoot: 'bytes32',
              sizeBytes: 'uint64',
              price: 'uint256',
              penalty: 'uint256',
              leaseDuration: 'uint256',
              lastValidSealTs: 'uint256'
            }
          }],
        [erc20.address, leaseDeal]
      )

      const messageHash = web3.utils.keccak256(abiEncoded)
      const lesseeSignature = await web3.eth.sign(messageHash, lessee)
      const lessorSignature = await web3.eth.sign(messageHash, lessor)

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)
      const lesseeBalance = await instance.balance(lessee)
      expect(lesseeBalance.available).to.eq('89999')
      expect(lesseeBalance.lockedRents).to.eq('10000')
      expect(lesseeBalance.lockedPenalties).to.eq('0')

      const lessorBalance = await instance.balance(lessor)
      expect(lessorBalance.available).to.eq('99499')
      expect(lessorBalance.lockedRents).to.eq('0')
      expect(lessorBalance.lockedPenalties).to.eq('500')
    })
  })
})
