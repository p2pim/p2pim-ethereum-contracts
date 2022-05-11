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

  mapping(address => uint256) public holdings;

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
      if (lease.leaseEnd > block.timestamp) {
        lockedRents += (lease.price * (lease.leaseEnd - block.timestamp)) / (lease.leaseEnd - lease.leaseStart);
      }
    }

    bytes32[] memory lets = _lets[holder];
    for (uint256 i = 0; i < lets.length; i++) {
      Lease memory lease = _leases[lets[i]];
      if (lease.leaseEnd > block.timestamp) {
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
}
