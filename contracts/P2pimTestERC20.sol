pragma solidity >=0.8.9 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

contract P2pimTestERC20 is ERC20PresetFixedSupply {
      constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address owner
    ) ERC20PresetFixedSupply(name, symbol, initialSupply, owner) {
    }

}