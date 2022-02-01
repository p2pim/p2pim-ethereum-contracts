// SPDX-License-Identifier: MIT
pragma solidity >=0.8.9 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract P2pimAdjudicator {
  using SafeERC20 for IERC20;

  event Deposited(address indexed user, address asset, uint256 amount);

  event Withdrawn(address indexed user, address asset, uint256 amount);

  mapping(address => mapping(address => uint256)) public holdings;

  function deposit(
    address asset,
    uint256 amount,
    address onBehalfOf
  ) external payable {
    require(amount > 0, "Incorrect amount for deposit");

    IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

    uint256 held = holdings[onBehalfOf][asset];
    uint256 nowHeld = held + amount;
    holdings[onBehalfOf][asset] = nowHeld;
    emit Deposited(onBehalfOf, asset, amount);
  }

  function withdraw(
    address asset,
    uint256 amount,
    address toAddress
  ) external {
    require(amount > 0, "Incorrect amount for withdraw");
    uint256 held = holdings[msg.sender][asset];
    require(amount <= held, "Not enough holdings");

    IERC20(asset).safeTransfer(toAddress, amount);

    uint256 nowHeld = held - amount;
    holdings[msg.sender][asset] = nowHeld;
    emit Withdrawn(msg.sender, asset, amount);
  }
}
