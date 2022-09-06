const P2pimAdjudicator = artifacts.require('P2pimAdjudicator')
const ERC20PresetFixedSupply = artifacts.require('@openzeppelin/contracts/ERC20PresetFixedSupply')

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const truffleAssert = require('truffle-assertions')

chai.use(chaiAsPromised)

const { expect } = chai

contract('P2pimAdjudicator', async accounts => {
  const initialSupply = 100000000000000

  const owner = accounts[0]
  const lessee = accounts[1]
  const lessor = accounts[2]

  const erc20 = await ERC20PresetFixedSupply.new('P2pimTestERC20', 'P2PIM', initialSupply, owner)

  const exampleLease = ({ price = 10000, penalty = 500 } = {}) => ({
    lessee: lessee,
    lessor: lessor,
    nonce: Math.round(Math.random() * Number.MAX_SAFE_INTEGER),
    merkleRoot: web3.utils.keccak256('test'),
    sizeBytes: 5,
    price: price,
    penalty: penalty,
    leaseDuration: 86400,
    lastValidSealTs: Date.now() + 100000
  })

  const encodeLeaseForSignature = (leaseDeal) => web3.eth.abi.encodeParameters(
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

  let instance

  beforeEach(async () => {
    instance = await P2pimAdjudicator.new(erc20.address)
  })

  describe('deposit', async () => {
    it('should not allow 0', async () => {
      return expect(instance.deposit(0, owner)).be.rejectedWith('Incorrect amount for deposit')
    })

    it('should allow to transfer assets', async () => {
      const allowance = 99999
      const transferAmount = 10

      await erc20.approve(instance.address, allowance)

      const tx = await instance.deposit(transferAmount, owner)

      truffleAssert.eventEmitted(tx, 'Deposited', (ev) => {
        return ev.user === owner &&
          ev.amount.toNumber() === transferAmount
      })
    })

    it('should fail if not enough assets', async () => {
      const allowance = initialSupply + 1
      const transferAmount = initialSupply + 1

      await erc20.approve(instance.address, allowance)
      return expect(instance.deposit(transferAmount, owner)).be.rejectedWith('transfer amount exceeds balance')
    })
  })
  describe('withdraw', async () => {
    it('should not allow 0', async () => {
      return expect(instance.withdraw(0, owner)).be.rejectedWith('Incorrect amount for withdraw')
    })

    it('should allow to withdraw holdings', async () => {
      const allowance = 99999
      const transferAmount = 10

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, owner)

      const withdrawTx = await instance.withdraw(transferAmount, lessee)

      truffleAssert.eventEmitted(withdrawTx, 'Withdrawn', (ev) => {
        return ev.user === owner &&
          ev.amount.toNumber() === transferAmount
      })
    })

    it('should not allow to withdraw more than deposited', async () => {
      const allowance = 99999
      const transferAmount = 10
      const withdrawAmount = transferAmount + 1

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, owner)

      return expect(instance.withdraw(withdrawAmount, lessee)).be.rejectedWith('Not enough holdings')
    })
  })
  describe('balance', async () => {
    it('should return 0 when no deposits', async () => {
      const balance = await instance.balance.call(owner)
      expect(balance.available).to.equal('0')
    })
    it('should return the deposited value', async () => {
      const allowance = 99999
      const transferAmount = 10
      const withdrawAmount = transferAmount - 3

      await erc20.approve(instance.address, allowance)

      await instance.deposit(transferAmount, owner)
      await instance.withdraw(withdrawAmount, owner)

      const balance = await instance.balance.call(owner)
      expect(balance.available).to.equal('3')
    })
    it('should have into account deals', async () => {
      const allowance = 100000000
      const transferAmount = 99999

      await erc20.approve(instance.address, allowance)
      await instance.deposit(transferAmount, lessee)
      await instance.deposit(transferAmount, lessor)

      const leaseDeal = exampleLease()
      const abiEncoded = encodeLeaseForSignature(leaseDeal)
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
  describe('sealLease', async () => {
    it('should fail if lesseeSignature is not valid', async () => {
      const leaseDeal = exampleLease()
      const abiEncoded = encodeLeaseForSignature(leaseDeal)

      const messageHash = web3.utils.keccak256(abiEncoded)
      const lesseeSignature = await web3.eth.sign('this is not expected', lessee)
      const lessorSignature = await web3.eth.sign(messageHash, lessor)

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessee signature not valid')
    })
    it('should fail if lessorSignature is not valid', async () => {
      const leaseDeal = exampleLease()
      const abiEncoded = encodeLeaseForSignature(leaseDeal)
      const messageHash = web3.utils.keccak256(abiEncoded)
      const lesseeSignature = await web3.eth.sign(messageHash, lessee)
      const lessorSignature = await web3.eth.sign('this is not valid', lessor)

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessor signature not valid')
    })
    it('should fail if lessee not have enough available', async () => {
      const allowance = 100000000
      const transferAmount = 99998

      await erc20.approve(instance.address, allowance)
      await instance.deposit(transferAmount, lessee)
      await instance.deposit(transferAmount, lessor)

      const leaseDeal = exampleLease({ price: 99999 })
      const abiEncoded = encodeLeaseForSignature(leaseDeal)

      const messageHash = web3.utils.keccak256(abiEncoded)
      const lesseeSignature = await web3.eth.sign(messageHash, lessee)
      const lessorSignature = await web3.eth.sign(messageHash, lessor)

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessee does not have enough available balance')
    })

    it('should fail if lessor not have enough available for penalty', async () => {
      const allowance = 100000000
      const transferAmount = 99998

      await erc20.approve(instance.address, allowance)
      await instance.deposit(transferAmount, lessee)
      await instance.deposit(transferAmount, lessor)

      const leaseDeal = exampleLease({ price: 99998, penalty: 99999 })
      const abiEncoded = encodeLeaseForSignature(leaseDeal)
      const messageHash = web3.utils.keccak256(abiEncoded)
      const lesseeSignature = await web3.eth.sign(messageHash, lessee)
      const lessorSignature = await web3.eth.sign(messageHash, lessor)

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessor does not have enough available balance')
    })
  })
})
