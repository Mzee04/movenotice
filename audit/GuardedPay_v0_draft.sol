// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MoveNotice} from "./MoveNotice_v0_draft.sol";

/// @title GuardedPay
/// @notice Forward a native payment only when the recipient has no effective move.
contract GuardedPay {
    /// @notice The notice board used for this first check.
    MoveNotice public immutable notice;

    /// @notice The recipient moved. Review the suggested account before retrying.
    error AccountMoved(address to, address newAccount);
    /// @notice The recipient reverted or could not receive payment.
    error TransferFailed();

    /// @notice A payment forwarded to its original recipient.
    event Paid(address indexed sender, address indexed to, uint256 amount, bool movePending);

    /// @notice Set the notice board for all future checks.
    constructor(MoveNotice notice_) {
        notice = notice_;
    }

    /// @notice Forward the full call value unless a final move is in force.
    function pay(address payable to) external payable {
        (address next, MoveNotice.Status status,) = notice.resolve(to);
        if (status == MoveNotice.Status.FINAL) revert AccountMoved(to, next);
        (bool success,) = to.call{value: msg.value}("");
        if (!success) revert TransferFailed();
        emit Paid(msg.sender, to, msg.value, status == MoveNotice.Status.PENDING);
    }

    /// @notice Return whether payment can proceed, any suggested recipient, and the move status.
    function check(address to) external view returns (bool ok, address suggested, MoveNotice.Status status) {
        (suggested, status,) = notice.resolve(to);
        return (status != MoveNotice.Status.FINAL, suggested, status);
    }
}
