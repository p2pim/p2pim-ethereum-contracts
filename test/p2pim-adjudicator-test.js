const P2pimAdjudicator = artifacts.require('P2pimAdjudicator');
const ERC20PresetFixedSupply = artifacts.require('@openzeppelin/contracts/ERC20PresetFixedSupply');

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const truffleAssert = require('truffle-assertions');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');

chai.use(chaiAsPromised);
chai.should();

const { expect } = chai;

const advanceTime = (time) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [time],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err); }
      return resolve(result);
    });
  });
};

const advanceBlock = () => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err); }
      const newBlockHash = web3.eth.getBlock('latest').hash;

      return resolve(newBlockHash);
    });
  });
};

const takeSnapshot = () => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_snapshot',
      id: new Date().getTime()
    }, (err, snapshotId) => {
      if (err) { return reject(err); }
      return resolve(snapshotId);
    });
  });
};

const revertToSnapShot = (id) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_revert',
      params: [id],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err); }
      return resolve(result);
    });
  });
};

const advanceTimeAndBlock = async (time) => {
  await advanceTime(time);
  await advanceBlock();
  return Promise.resolve(web3.eth.getBlock('latest'));
};

const randomMerkleRoot = (storageBlockSize, sizeBytes, storageBlock) => {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    randomByte = Math.round(Math.random() * 255);
    buf[i] = randomByte;
  }

  const leaves = [];
  let remain = sizeBytes;
  let block = 0;
  while (remain > 0) {
    const currentBlock = buf.subarray(block * storageBlockSize, (block + 1) * storageBlockSize);
    const hash = keccak256(currentBlock);
    leaves.push(hash);
    block++;
    remain -= storageBlockSize;
  }

  const tree = new MerkleTree(leaves, keccak256);
  const root = '0x' + tree.getRoot().toString('hex');
  const proof = tree.getProof(leaves[storageBlock], storageBlock);

  return {
    root,
    proof: proof.map((v) => '0x' + v.data.toString('hex')),
    blockData: '0x' + buf.subarray(storageBlock * storageBlockSize, (storageBlock + 1) * storageBlockSize).toString('hex')
  };
};

contract('P2pimAdjudicator', async accounts => {
  const initialSupply = 100000000000000;

  const owner = accounts[0];
  const lessee = accounts[1];
  const lessor = accounts[2];

  const exampleLease = (override = {}) => ({
    lessee: lessee,
    lessor: lessor,
    nonce: Math.round(Math.random() * Number.MAX_SAFE_INTEGER),
    merkleRoot: web3.utils.keccak256('test'),
    sizeBytes: 5,
    price: 10000,
    penalty: 500,
    leaseDuration: 86400,
    lastValidSealTs: Date.now() + 100000,
    ...override
  });

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
  );

  let instance;
  let erc20;

  beforeEach(async () => {
    erc20 = await ERC20PresetFixedSupply.new('P2pimTestERC20', 'P2PIM', initialSupply, owner);
    instance = await P2pimAdjudicator.new(erc20.address);
  });

  describe('deposit', async () => {
    it('should not allow 0', async () => {
      return expect(instance.deposit(0, owner)).be.rejectedWith('Incorrect amount for deposit');
    });

    it('should allow to transfer assets', async () => {
      const allowance = 99999;
      const transferAmount = 10;

      await erc20.approve(instance.address, allowance);

      const tx = await instance.deposit(transferAmount, owner);

      truffleAssert.eventEmitted(tx, 'Deposited', (ev) => {
        return ev.user === owner &&
          ev.amount.toNumber() === transferAmount;
      });
    });

    it('should fail if not enough assets', async () => {
      const allowance = initialSupply + 1;
      const transferAmount = initialSupply + 1;

      await erc20.approve(instance.address, allowance);
      return expect(instance.deposit(transferAmount, owner)).be.rejectedWith('transfer amount exceeds balance');
    });
  });
  describe('withdraw', async () => {
    it('should not allow 0', async () => {
      return expect(instance.withdraw(0, owner)).be.rejectedWith('Incorrect amount for withdraw');
    });

    it('should allow to withdraw holdings', async () => {
      const allowance = 99999;
      const transferAmount = 10;

      await erc20.approve(instance.address, allowance);

      await instance.deposit(transferAmount, owner);

      const withdrawTx = await instance.withdraw(transferAmount, lessee);

      truffleAssert.eventEmitted(withdrawTx, 'Withdrawn', (ev) => {
        return ev.user === owner &&
          ev.amount.toNumber() === transferAmount;
      });
    });

    it('should not allow to withdraw more than deposited', async () => {
      const allowance = 99999;
      const transferAmount = 10;
      const withdrawAmount = transferAmount + 1;

      await erc20.approve(instance.address, allowance);

      await instance.deposit(transferAmount, owner);

      return expect(instance.withdraw(withdrawAmount, lessee)).be.rejectedWith('Not enough holdings');
    });
  });
  describe('balance', async () => {
    it('should return 0 when no deposits', async () => {
      const balance = await instance.balance.call(owner);
      expect(balance.available).to.equal('0');
    });
    it('should return the deposited value', async () => {
      const allowance = 99999;
      const transferAmount = 10;
      const withdrawAmount = transferAmount - 3;

      await erc20.approve(instance.address, allowance);

      await instance.deposit(transferAmount, owner);
      await instance.withdraw(withdrawAmount, owner);

      const balance = await instance.balance.call(owner);
      expect(balance.available).to.equal('3');
    });
    it('should have into account deals', async () => {
      const allowance = 100000000;
      const transferAmount = 99999;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease();
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);

      const lesseeBalance = await instance.balance(lessee);
      expect(lesseeBalance.available).to.eq('89999');
      expect(lesseeBalance.lockedRents).to.eq('10000');
      expect(lesseeBalance.lockedPenalties).to.eq('0');

      const lessorBalance = await instance.balance(lessor);
      expect(lessorBalance.available).to.eq('99499');
      expect(lessorBalance.lockedRents).to.eq('0');
      expect(lessorBalance.lockedPenalties).to.eq('500');
    });
  });
  describe('sealLease', async () => {
    it('should fail if nonce is 0', async () => {
      const leaseDeal = exampleLease({ nonce: 0 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);

      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Nonce cannot be 0');
    });
    it('should fail if lesseeSignature is not valid', async () => {
      const leaseDeal = exampleLease();
      const abiEncoded = encodeLeaseForSignature(leaseDeal);

      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign('this is not expected', lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessee signature not valid');
    });
    it('should fail if lessorSignature is not valid', async () => {
      const leaseDeal = exampleLease();
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign('this is not valid', lessor);

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessor signature not valid');
    });
    it('should fail if lessee not have enough available', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 99999 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);

      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessee does not have enough available balance');
    });

    it('should fail if lessor not have enough available for penalty', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 99998, penalty: 99999 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      return expect(instance.sealLease(leaseDeal, lesseeSignature, lessorSignature)).be.rejectedWith('Lessor does not have enough available balance');
    });
  });
  describe('challenge', async () => {
    it('should fail if the lease does not exists', async () => {
      const nonExistingNonce = 1;
      return expect(instance.challenge(lessor, nonExistingNonce, 0)).be.rejectedWith('Lease not found');
    });
    it('should fail if there is an active challenge for the lease', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 10, penalty: 10, leaseDuration: 86400 * 2 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
      await instance.challenge(lessor, leaseDeal.nonce, 0, { from: lessee });

      return expect(instance.challenge(lessor, leaseDeal.nonce, 0, { from: lessee })).be.rejectedWith('Pending challenge in progress');
    });
    it('should fail if the lease is going to end', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 10, penalty: 10, leaseDuration: 60 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
      return expect(instance.challenge(lessor, leaseDeal.nonce, 0, { from: lessee })).be.rejectedWith('Lease is ended or about to end');
    });
    it('should fail if block is not acceptable', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;
      const storageBlock = 4;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 10, penalty: 10, leaseDuration: 86401, sizeBytes: 544 * storageBlock });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
      return expect(instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee })).be.rejectedWith('Storage block out of range');
    });
    it('should emit event', async () => {
      const allowance = 100000000;
      const transferAmount = 99998;
      const storageBlock = 0;

      await erc20.approve(instance.address, allowance);
      await instance.deposit(transferAmount, lessee);
      await instance.deposit(transferAmount, lessor);

      const leaseDeal = exampleLease({ price: 10, penalty: 10, leaseDuration: 86401 });
      const abiEncoded = encodeLeaseForSignature(leaseDeal);
      const messageHash = web3.utils.keccak256(abiEncoded);
      const lesseeSignature = await web3.eth.sign(messageHash, lessee);
      const lessorSignature = await web3.eth.sign(messageHash, lessor);

      await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
      const challengeTx = await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

      const block = await web3.eth.getBlock(challengeTx.receipt.blockNumber);

      const expectedEnd = block.timestamp + 86400;
      truffleAssert.eventEmitted(challengeTx, 'Challenged', (ev) => {
        return ev.lessee === lessee &&
          ev.lessor === lessor &&
          ev.nonce.toNumber() === leaseDeal.nonce &&
          ev.storageBlock.toNumber() === storageBlock &&
          ev.challengeEnd.toNumber() === expectedEnd;
      });
    });
    context('when aborted', async () => {
      it('should be into account for balance', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 0;

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const leaseDeal = exampleLease({ price: 20, penalty: 15, leaseDuration: 86400 * 2 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

        await advanceTimeAndBlock(86401);

        const balanceLessor = await instance.balance.call(lessor);
        expect(balanceLessor.available).to.equal('15');
        expect(balanceLessor.lockedPenalties).to.equal('0');

        const balanceLessee = await instance.balance.call(lessee);
        expect(balanceLessee.available).to.equal('25');
        expect(balanceLessee.lockedRents).to.equal('0');
      });
    });
  });
  describe('response', async () => {
    it('should revert when nonce is 0', async () => {
      return expect(instance.response(lessee, 0, '0x123', [])).be.rejectedWith('Invalid nonce');
    });
    it('should revert when no lease', async () => {
      const randomNonce = 5;
      return expect(instance.response(lessee, randomNonce, '0x123', [])).be.rejectedWith('Lease not found');
    });
    context('with lease', async () => {
      it('should revert if no challenge', async () => {
        const allowance = 100000000;
        const transferAmount = 20;

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const leaseDeal = exampleLease({ price: 20, penalty: 15, leaseDuration: 86400 * 2 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        return expect(instance.response(lessee, leaseDeal.nonce, '0x123', [], { from: lessor })).be.rejectedWith('Lease not chellenged');
      });
      it('should revert if bad proof', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 0;

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const leaseDeal = exampleLease({ price: 20, penalty: 15, leaseDuration: 86400 * 2 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });
        return expect(instance.response(lessee, leaseDeal.nonce, '0x123', [], { from: lessor })).be.rejectedWith('Proof not valid - wrong hash');
      });
      it('should revert if not enough proof data', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 0;

        const storageBlockSize = (await instance.STORAGE_BLOCK_SIZE_BYTES.call()).toNumber();

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const leaseDeal = exampleLease({ price: 20, penalty: 15, leaseDuration: 86400 * 2, sizeBytes: storageBlockSize * 6 + 1 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

        const proof = [web3.utils.keccak256('test')];
        return expect(instance.response(lessee, leaseDeal.nonce, '0x123', proof, { from: lessor })).be.rejectedWith('Proof not valid - missing data');
      });
      it('should revert if too much proof data', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 0;

        const storageBlockSize = (await instance.STORAGE_BLOCK_SIZE_BYTES.call()).toNumber();

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const leaseDeal = exampleLease({ price: 20, penalty: 15, leaseDuration: 86400 * 2, sizeBytes: storageBlockSize * 6 + 1 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

        const sampleHash = web3.utils.keccak256('test');
        const proof = [sampleHash, sampleHash, sampleHash, sampleHash];
        return expect(instance.response(lessee, leaseDeal.nonce, '0x123', proof, { from: lessor })).be.rejectedWith('Proof not valid - too much data');
      });
      it('should cancel the challenge if proof correct', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 2;
        const totalBlocks = 7;

        const storageBlockSize = (await instance.STORAGE_BLOCK_SIZE_BYTES.call()).toNumber();

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const sizeBytes = storageBlockSize * (totalBlocks - 1) + 1;
        const { root, proof, blockData } = randomMerkleRoot(storageBlockSize, sizeBytes, storageBlock);

        const leaseDeal = exampleLease({ merkleRoot: root, price: 20, penalty: 15, leaseDuration: 86400 * 2, sizeBytes: storageBlockSize * (totalBlocks - 1) + 1 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

        await instance.response(lessee, leaseDeal.nonce, blockData, proof, { from: lessor });

        await advanceTimeAndBlock(86400);

        const balanceLessor = await instance.balance.call(lessor);
        expect(balanceLessor.available).to.equal('15');
        expect(balanceLessor.lockedPenalties).to.equal('15');

        const balanceLessee = await instance.balance.call(lessee);
        expect(balanceLessee.available).to.equal('0');
        expect(balanceLessee.lockedRents).to.equal('10');
      });

      it('should emit ChallengeResolved if proof correct', async () => {
        const allowance = 100000000;
        const transferAmount = 20;
        const storageBlock = 2;
        const totalBlocks = 7;

        const storageBlockSize = (await instance.STORAGE_BLOCK_SIZE_BYTES.call()).toNumber();

        await erc20.approve(instance.address, allowance);
        await instance.deposit(transferAmount, lessee);
        await instance.deposit(transferAmount, lessor);

        const sizeBytes = storageBlockSize * (totalBlocks - 1) + 1;
        const { root, proof, blockData } = randomMerkleRoot(storageBlockSize, sizeBytes, storageBlock);

        const leaseDeal = exampleLease({ merkleRoot: root, price: 20, penalty: 15, leaseDuration: 86400 * 2, sizeBytes: storageBlockSize * (totalBlocks - 1) + 1 });
        const abiEncoded = encodeLeaseForSignature(leaseDeal);
        const messageHash = web3.utils.keccak256(abiEncoded);
        const lesseeSignature = await web3.eth.sign(messageHash, lessee);
        const lessorSignature = await web3.eth.sign(messageHash, lessor);

        await instance.sealLease(leaseDeal, lesseeSignature, lessorSignature);
        await instance.challenge(lessor, leaseDeal.nonce, storageBlock, { from: lessee });

        const responseTx = await instance.response(lessee, leaseDeal.nonce, blockData, proof, { from: lessor });

        truffleAssert.eventEmitted(responseTx, 'ChallengeResolved', (ev) => {
          return ev.lessee === lessee &&
            ev.lessor === lessor &&
            ev.nonce.toNumber() === leaseDeal.nonce;
        });
      });
    });
  });
});
