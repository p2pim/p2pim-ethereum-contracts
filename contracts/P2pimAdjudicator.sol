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

  IERC20 public immutable token;

  constructor(address _token) {
    token = IERC20(_token);
  }

  struct Balance {
    uint256 available;
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
    uint256 held = holdings[msg.sender];
    require(amount <= held, "Not enough holdings");

    token.safeTransfer(toAddress, amount);

    uint256 nowHeld = held - amount;
    holdings[msg.sender] = nowHeld;
    emit Withdrawn(msg.sender, amount);
  }

  function balance(address holder) public view returns (Balance memory) {
    uint256 held = holdings[holder];
    return Balance(held);
  }

  function sealLease(
    LeaseDeal memory deal,
    bytes memory lesseeSignature,
    bytes memory lessorSignature
  ) external {
    bytes memory message = abi.encode(token, deal);
    bytes32 messageHash = keccak256(message);

    address addressLesseeSig = ECDSA.recover(messageHash, lesseeSignature);
    require(addressLesseeSig == deal.lessee, "Lessee signature not valid: ");

    address addressLessorSig = ECDSA.recover(messageHash, lessorSignature);
    require(addressLessorSig == deal.lessor, "Lessor signature not valid");

    require(deal.lastValidSealTs > block.timestamp, "The proposal is no longer valid");

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
