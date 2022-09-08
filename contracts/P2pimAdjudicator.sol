// SPDX-License-Identifier: MIT
pragma solidity >=0.8.9 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract P2pimAdjudicator {
  using SafeERC20 for IERC20;

  event Deposited(address indexed user, uint256 amount);

  event Withdrawn(address indexed user, uint256 amount);

  event LeaseSealed(
    address indexed lessee,
    address indexed lessor,
    uint64 nonce,
    bytes32 merkleRoot,
    uint64 sizeBytes,
    uint256 price,
    uint256 penalty,
    uint256 leaseDuration
  );

  event Challenged(
    address indexed lessee,
    address indexed lessor,
    uint64 nonce,
    uint64 storageBlock,
    uint256 challengeEnd
  );

  event ChallengeResolved(address indexed lessee, address indexed lessor, uint64 nonce);

  mapping(address => uint256) public holdings;

  uint64 public constant CHALLENGE_DURATION = 1 days;
  uint64 public constant STORAGE_BLOCK_SIZE_BYTES = 544;

  mapping(address => bytes32[]) internal _rents;
  mapping(address => bytes32[]) internal _lets;

  struct Lease {
    address lessee;
    address lessor;
    uint64 nonce;
    bytes32 merkleRoot;
    uint64 sizeBytes;
    uint256 price;
    uint256 penalty;
    uint256 leaseStart;
    uint256 leaseEnd;
  }

  mapping(bytes32 => Lease) internal _leases;

  struct Challenge {
    uint64 storageBlock;
    uint256 challengeEnd;
  }

  mapping(bytes32 => Challenge) internal _challenges;

  IERC20 public immutable token;

  constructor(address _token) {
    token = IERC20(_token);
  }

  struct Balance {
    uint256 available;
    uint256 lockedRents;
    uint256 lockedPenalties;
  }

  struct LeaseDeal {
    address lessee;
    address lessor;
    uint64 nonce;
    bytes32 merkleRoot;
    uint64 sizeBytes;
    uint256 price;
    uint256 penalty;
    uint256 leaseDuration;
    uint256 lastValidSealTs;
  }

  function deposit(uint256 amount, address onBehalfOf) external payable {
    require(amount > 0, "Incorrect amount for deposit");

    token.safeTransferFrom(msg.sender, address(this), amount);

    uint256 held = holdings[onBehalfOf];
    uint256 nowHeld = held + amount;
    holdings[onBehalfOf] = nowHeld;
    emit Deposited(onBehalfOf, amount);
  }

  function withdraw(uint256 amount, address toAddress) external {
    require(amount > 0, "Incorrect amount for withdraw");
    uint256 held = balance(msg.sender).available;
    require(amount <= held, "Not enough holdings available");

    token.safeTransfer(toAddress, amount);

    uint256 nowHeld = held - amount;
    holdings[msg.sender] = nowHeld;
    emit Withdrawn(msg.sender, amount);
  }

  function balance(address holder) public view returns (Balance memory) {
    uint256 held = holdings[holder];

    uint256 available = held;
    uint256 lockedRents = 0;
    uint256 lockedPenalties = 0;

    bytes32[] memory rents = _rents[holder];
    for (uint256 i = 0; i < rents.length; i++) {
      Lease memory lease = _leases[rents[i]];
      available -= lease.price;
      Challenge memory challenge = _challenges[rents[i]];
      if (challenge.challengeEnd > 0 && challenge.challengeEnd < block.timestamp) {
        available += lease.penalty;
        available += (lease.price * (lease.leaseEnd - challenge.challengeEnd)) / (lease.leaseEnd - lease.leaseStart);
      } else if (lease.leaseEnd > block.timestamp) {
        lockedRents += (lease.price * (lease.leaseEnd - block.timestamp)) / (lease.leaseEnd - lease.leaseStart);
      }
    }

    bytes32[] memory lets = _lets[holder];
    for (uint256 i = 0; i < lets.length; i++) {
      Lease memory lease = _leases[lets[i]];
      Challenge memory challenge = _challenges[lets[i]];
      if (challenge.challengeEnd > 0 && challenge.challengeEnd < block.timestamp) {
        available += (lease.price * (challenge.challengeEnd - lease.leaseStart)) / (lease.leaseEnd - lease.leaseStart);
        available -= lease.penalty;
      } else if (lease.leaseEnd > block.timestamp) {
        available += (lease.price * (block.timestamp - lease.leaseStart)) / (lease.leaseEnd - lease.leaseStart);
        available -= lease.penalty;
        lockedPenalties += lease.penalty;
      } else {
        available += lease.price;
      }
    }

    return Balance(available, lockedRents, lockedPenalties);
  }

  function _checkLeaseSignature(
    LeaseDeal memory deal,
    bytes memory lesseeSignature,
    bytes memory lessorSignature
  ) internal view {
    bytes memory message = abi.encode(token, deal);
    bytes32 messageHash = ECDSA.toEthSignedMessageHash(keccak256(message));

    address addressLesseeSig = ECDSA.recover(messageHash, lesseeSignature);
    require(addressLesseeSig == deal.lessee, "Lessee signature not valid: ");

    address addressLessorSig = ECDSA.recover(messageHash, lessorSignature);
    require(addressLessorSig == deal.lessor, "Lessor signature not valid");
  }

  function sealLease(
    LeaseDeal memory deal,
    bytes memory lesseeSignature,
    bytes memory lessorSignature
  ) external {
    require(deal.nonce != 0, "Nonce cannot be 0");

    _checkLeaseSignature(deal, lesseeSignature, lessorSignature);

    require(deal.lastValidSealTs > block.timestamp, "The proposal is no longer valid");

    uint256 lesseeAvailable = balance(deal.lessee).available;
    uint256 lessorAvailbale = balance(deal.lessor).available;

    require(lesseeAvailable >= deal.price, "Lessee does not have enough available balance");
    require(lessorAvailbale >= deal.penalty, "Lessor does not have enough available balance");

    bytes32 leaseId = keccak256(abi.encode(deal.lessee, deal.lessor, deal.nonce));
    require(_leases[leaseId].nonce == 0, "Lease duplicated");

    Lease memory lease = Lease({
      lessee: deal.lessee,
      lessor: deal.lessor,
      nonce: deal.nonce,
      merkleRoot: deal.merkleRoot,
      sizeBytes: deal.sizeBytes,
      price: deal.price,
      penalty: deal.penalty,
      leaseStart: block.timestamp,
      leaseEnd: block.timestamp + deal.leaseDuration
    });

    _leases[leaseId] = lease;
    _rents[deal.lessee].push(leaseId);
    _lets[deal.lessor].push(leaseId);

    emit LeaseSealed(
      deal.lessee,
      deal.lessor,
      deal.nonce,
      deal.merkleRoot,
      deal.sizeBytes,
      deal.price,
      deal.penalty,
      deal.leaseDuration
    );
  }

  function challenge(
    address lessor,
    uint64 nonce,
    uint64 storageBlock
  ) external {
    bytes32 leaseId = keccak256(abi.encode(msg.sender, lessor, nonce));
    Lease memory lease = _leases[leaseId];
    require(lease.nonce != 0, "Lease not found");

    uint256 challengeEnd = block.timestamp + CHALLENGE_DURATION;

    require(_challenges[leaseId].challengeEnd < block.timestamp, "Pending challenge in progress");
    require(challengeEnd <= lease.leaseEnd, "Lease is ended or about to end");
    require(
      storageBlock < lease.sizeBytes / STORAGE_BLOCK_SIZE_BYTES ||
        (storageBlock == lease.sizeBytes / STORAGE_BLOCK_SIZE_BYTES && lease.sizeBytes % STORAGE_BLOCK_SIZE_BYTES > 0),
      "Storage block out of range"
    );

    _challenges[leaseId] = Challenge({storageBlock: storageBlock, challengeEnd: challengeEnd});
    emit Challenged(msg.sender, lessor, nonce, storageBlock, challengeEnd);
  }

  function response(
    address lessee,
    uint64 nonce,
    bytes calldata blockData,
    bytes32[] calldata proof
  ) external {
    require(nonce > 0, "Invalid nonce");

    bytes32 leaseId = keccak256(abi.encode(lessee, msg.sender, nonce));
    Lease memory lease = _leases[leaseId];
    require(lease.nonce != 0, "Lease not found");

    require(_challenges[leaseId].challengeEnd >= block.timestamp, "Lease not chellenged");

    uint64 storageBlock = _challenges[leaseId].storageBlock;

    _verifyMerkleTree(_blocks(lease.sizeBytes), storageBlock, lease.merkleRoot, blockData, proof);

    delete _challenges[leaseId];

    emit ChallengeResolved(lessee, msg.sender, nonce);
  }

  function _blocks(uint64 sizeBytes) internal pure returns (uint64) {
    return sizeBytes / STORAGE_BLOCK_SIZE_BYTES + (sizeBytes % STORAGE_BLOCK_SIZE_BYTES > 0 ? 1 : 0);
  }

  function _verifyMerkleTree(
    uint64 totalBlocks,
    uint64 storageBlock,
    bytes32 merkleRoot,
    bytes memory blockData,
    bytes32[] calldata proof
  ) internal {
    bytes32 computedHash = keccak256(blockData);
    _verifyMerkleTreeRecursive(totalBlocks, storageBlock, merkleRoot, computedHash, proof, 0);
  }

  function _verifyMerkleTreeRecursive(
    uint64 totalleaves,
    uint64 currentLeaf,
    bytes32 merkleRoot,
    bytes32 currentLeafHash,
    bytes32[] calldata proof,
    uint64 index
  ) internal pure {
    // assert(totalleaves > currentLeaf);

    if (totalleaves == 1) {
      require(index == proof.length, "Proof not valid - too much data");
      require(merkleRoot == currentLeafHash, "Proof not valid - wrong hash");
      return;
    }

    require(index < proof.length, "Proof not valid - missing data");
    if (currentLeaf % 2 == 0 && currentLeaf == totalleaves - 1) {
      _verifyMerkleTreeRecursive(
        totalleaves / 2 + (totalleaves % 2),
        currentLeaf / 2,
        merkleRoot,
        currentLeafHash,
        proof,
        index + 1 // is this correct?
      );
    } else {
      bytes32 proofElement = proof[index];
      if (currentLeaf % 2 == 0) {
        currentLeafHash = keccak256(abi.encodePacked(currentLeafHash, proofElement));
      } else {
        currentLeafHash = keccak256(abi.encodePacked(proofElement, currentLeafHash));
      }
      _verifyMerkleTreeRecursive(
        totalleaves / 2 + (totalleaves % 2),
        currentLeaf / 2,
        merkleRoot,
        currentLeafHash,
        proof,
        index + 1
      );
    }
  }
}
