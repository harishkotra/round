// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Round
/// @notice All-or-nothing token escrow with non-transferable backer records.
/// @dev The creator can never touch escrowed funds before the round is Settled.
/// All amounts are raw token units; no token decimals are assumed.
/// Exact balance/accounting equality holds unless tokens are sent directly here.
/// Withdraw sweeps those stray tokens to the creator only in Settled state.
/// In Refunded state stray tokens remain here and backers receive exactly their
/// commitments; there is no administrative recovery or payout mechanism.
contract Round is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { Open, Settled, Refunded }

    error InvalidCreator();
    error InvalidToken();
    error EmptyTitle();
    error InvalidTarget();
    error InvalidCap();
    error InvalidDeadline();
    error InvalidBacker();
    error NotOpen();
    error DeadlinePassed();
    error ZeroAmount();
    error ExceedsCap();
    error UnsupportedToken();
    error DeadlineNotReached();
    error NotCreator();
    error NotSettled();
    error AlreadyWithdrawn();
    error NotRefunded();
    error NothingToRefund();
    error InvariantViolated();

    address public immutable creator;
    string public title;
    string public metadataURI;
    uint256 public immutable target;
    uint64 public immutable deadline;
    uint256 public immutable perBackerCap;
    IERC20 public immutable usdc;

    State public state;
    uint256 public totalRaised;
    uint256 public totalRefunded;
    bool public withdrawn;
    uint256 public backerCount;
    address[] public backers;
    mapping(address => uint256) public commitments;
    mapping(address => bool) public refunded;

    event Committed(address indexed round, address indexed backer, uint256 amount, uint256 totalRaised);
    event Closed(State state, uint256 totalRaised);
    event Withdrawn(address indexed round, address indexed creator, uint256 amount);
    event Refunded(address indexed round, address indexed backer, uint256 amount);

    constructor(
        address creator_,
        string memory title_,
        string memory metadataURI_,
        uint256 target_,
        uint64 deadline_,
        uint256 perBackerCap_,
        IERC20 usdc_
    ) {
        if (creator_ == address(0)) revert InvalidCreator();
        if (address(usdc_) == address(0)) revert InvalidToken();
        if (bytes(title_).length == 0) revert EmptyTitle();
        if (target_ == 0) revert InvalidTarget();
        if (perBackerCap_ == 0) revert InvalidCap();
        if (deadline_ <= block.timestamp) revert InvalidDeadline();

        creator = creator_;
        title = title_;
        metadataURI = metadataURI_;
        target = target_;
        deadline = deadline_;
        perBackerCap = perBackerCap_;
        usdc = usdc_;
        state = State.Open;
    }

    /// @notice Commit tokens before the deadline, up to your cumulative cap.
    function commit(uint256 amount) external nonReentrant {
        if (state != State.Open) revert NotOpen();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (amount == 0) revert ZeroAmount();

        uint256 previous = commitments[msg.sender];
        if (amount > perBackerCap - previous) revert ExceedsCap();

        if (previous == 0) {
            backers.push(msg.sender);
            backerCount++;
        }
        commitments[msg.sender] = previous + amount;
        totalRaised += amount;

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnsupportedToken();
        }
        _checkInvariant();
        emit Committed(address(this), msg.sender, amount, totalRaised);
    }

    /// @notice Anyone can finalize the outcome at or after the deadline.
    function close() external {
        if (state != State.Open) revert NotOpen();
        if (block.timestamp < deadline) revert DeadlineNotReached();
        state = totalRaised >= target ? State.Settled : State.Refunded;
        emit Closed(state, totalRaised);
    }

    /// @notice Only the creator can withdraw, and only after successful settlement.
    /// @dev Sweeps the full token balance, including direct donations.
    function withdraw() external nonReentrant {
        if (msg.sender != creator) revert NotCreator();
        if (state != State.Settled) revert NotSettled();
        if (withdrawn) revert AlreadyWithdrawn();

        withdrawn = true;
        uint256 amount = usdc.balanceOf(address(this));
        usdc.safeTransfer(creator, amount);
        _checkInvariant();
        if (usdc.balanceOf(address(this)) != 0) revert InvariantViolated();
        emit Withdrawn(address(this), creator, amount);
    }

    /// @notice Pull your own commitment back after an unsuccessful round.
    function refund() external nonReentrant {
        if (state != State.Refunded) revert NotRefunded();
        uint256 amount = commitments[msg.sender];
        if (amount == 0) revert NothingToRefund();
        if (msg.sender == address(0)) revert InvalidBacker();

        commitments[msg.sender] = 0;
        refunded[msg.sender] = true;
        totalRefunded += amount;
        usdc.safeTransfer(msg.sender, amount);
        _checkInvariant();
        emit Refunded(address(this), msg.sender, amount);
    }

    function commitmentOf(address backer) external view returns (uint256) {
        return commitments[backer];
    }

    function backersLength() external view returns (uint256) {
        return backers.length;
    }

    /// @notice Historical backer addresses and their current commitments.
    function capTable() external view returns (address[] memory backers_, uint256[] memory amounts_) {
        backers_ = backers;
        amounts_ = new uint256[](backers_.length);
        for (uint256 i = 0; i < backers_.length; ++i) {
            amounts_[i] = commitments[backers_[i]];
        }
    }

    function summary() external view returns (
        address creator_,
        string memory title_,
        string memory metadataURI_,
        uint256 target_,
        uint64 deadline_,
        uint256 perBackerCap_,
        State state_,
        uint256 totalRaised_,
        uint256 backerCount_,
        bool withdrawn_
    ) {
        return (creator, title, metadataURI, target, deadline, perBackerCap,
            state, totalRaised, backerCount, withdrawn);
    }

    /// @notice Outstanding accounted tokens; direct donations are not counted.
    function accountedBalance() public view returns (uint256) {
        return withdrawn ? 0 : totalRaised - totalRefunded;
    }

    /// @dev A surplus must not prevent commitments or refunds.
    function _checkInvariant() internal view {
        if (usdc.balanceOf(address(this)) < accountedBalance()) revert InvariantViolated();
    }
}
