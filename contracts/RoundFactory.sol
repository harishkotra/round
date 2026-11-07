// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Round} from "./Round.sol";

/// @title RoundFactory
/// @notice Permissionless registry and deployment of independent Round escrows.
/// @dev No administrator, fees, upgrade mechanism, or custody of round funds.
/// All amounts are raw token units; no token decimals are assumed.
contract RoundFactory {
    error InvalidToken();

    IERC20 public immutable usdc;
    address[] private rounds;

    event RoundCreated(
        address indexed round,
        address indexed creator,
        string title,
        uint256 target,
        uint64 deadline
    );

    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert InvalidToken();
        usdc = usdc_;
    }

    /// @notice Open a new escrow with the caller permanently recorded as creator.
    function createRound(
        string memory title,
        string memory metadataURI,
        uint256 target,
        uint64 deadline,
        uint256 perBackerCap
    ) external returns (address) {
        address round = address(new Round(
            msg.sender, title, metadataURI, target, deadline, perBackerCap, usdc
        ));
        rounds.push(round);
        emit RoundCreated(round, msg.sender, title, target, deadline);
        return round;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    /// @notice Return the round at index; out-of-range indices revert.
    function roundAt(uint256 index) external view returns (address) {
        return rounds[index];
    }

    function allRounds() external view returns (address[] memory) {
        return rounds;
    }
}
