// SPDX-License-Identifier: MIT
pragma solidity >=0.8.9 <0.9.0;

contract P2pimMasterRecord {
  event Deployed(address indexed token, address adjudicator);

  struct P2pimAdjudicatorDeployment {
    address token;
    address adjudicator;
  }

  address _creator;
  // TODO: Check whether having an additional mapping is better for gas cost
  P2pimAdjudicatorDeployment[] _deployments;

  constructor() {
    _creator = msg.sender;
  }

  function registerDeployment(address token, address adjudicator) external {
    require(msg.sender == _creator, "Only creator can register deployments");
    for (uint256 index = 0; index < _deployments.length; index++) {
      if (_deployments[index].token == token) {
        revert("Adjudicator for the same token has already been deployed");
      }
    }
    _deployments.push(P2pimAdjudicatorDeployment(token, adjudicator));
    emit Deployed(token, adjudicator);
  }

  function deployments() public view returns (P2pimAdjudicatorDeployment[] memory) {
    return _deployments;
  }
}
