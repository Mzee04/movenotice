// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GuardedPay} from "../src/GuardedPay.sol";
import {MoveNotice} from "../src/MoveNotice.sol";
import {NoticeFixture} from "./MoveNotice.t.sol";

contract RejectPayment {
    receive() external payable {
        revert();
    }
}

contract NestedPayment {
    GuardedPay private immutable guard;
    address payable private immutable next;

    constructor(GuardedPay guard_, address payable next_) {
        guard = guard_;
        next = next_;
    }

    receive() external payable {
        guard.pay{value: msg.value}(next);
    }
}

contract GuardedPayTest is NoticeFixture {
    GuardedPay internal guard;

    function setUp() public override {
        super.setUp();
        guard = new GuardedPay(notice);
        vm.deal(address(this), 5 ether);
    }

    function test_pay_toUnmoved_forwards() public {
        vm.expectEmit(true, true, false, true, address(guard));
        emit GuardedPay.Paid(address(this), A, 1 ether, false);
        guard.pay{value: 1 ether}(payable(A));
        assertEq(A.balance, 1 ether);
        assertEq(address(guard).balance, 0);
    }

    function test_pay_toPending_forwardsAndFlags() public {
        _post(A, B);
        vm.expectEmit(true, true, false, true, address(guard));
        emit GuardedPay.Paid(address(this), A, 1 ether, true);
        guard.pay{value: 1 ether}(payable(A));
        assertEq(A.balance, 1 ether);
        assertEq(B.balance, 0);
    }

    function test_pay_toMoved_revertsWithSuggestion() public {
        _post(A, B);
        vm.warp(START + DELAY);
        vm.expectRevert(abi.encodeWithSelector(GuardedPay.AccountMoved.selector, A, B));
        guard.pay{value: 1 ether}(payable(A));
        assertEq(A.balance, 0);
        assertEq(B.balance, 0);
    }

    function test_check_view() public {
        _check(true, address(0), MoveNotice.Status.NONE);
        _post(A, B);
        _check(true, B, MoveNotice.Status.PENDING);
        vm.warp(START + DELAY);
        _check(false, B, MoveNotice.Status.FINAL);
    }

    function test_pay_revertingRecipientRollsBack() public {
        RejectPayment recipient = new RejectPayment();
        vm.expectRevert(GuardedPay.TransferFailed.selector);
        guard.pay{value: 1 ether}(payable(address(recipient)));
        assertEq(address(guard).balance, 0);
    }

    function test_nestedPaymentsEmitInEntryOrder() public {
        NestedPayment recipient = new NestedPayment(guard, payable(B));
        vm.expectEmit(true, true, false, true, address(guard));
        emit GuardedPay.Paid(address(this), address(recipient), 1 ether, false);
        vm.expectEmit(true, true, false, true, address(guard));
        emit GuardedPay.Paid(address(recipient), B, 1 ether, false);
        guard.pay{value: 1 ether}(payable(address(recipient)));
        assertEq(B.balance, 1 ether);
        assertEq(address(guard).balance, 0);
    }

    function test_constructor_rejectsMissingBoard() public {
        vm.expectRevert(GuardedPay.InvalidNoticeBoard.selector);
        new GuardedPay(MoveNotice(address(0)));
    }

    function _check(bool allowed, address suggestion, MoveNotice.Status state) private view {
        (bool ok, address suggested, MoveNotice.Status status) = guard.check(A);
        assertEq(ok, allowed);
        assertEq(suggested, suggestion);
        assertEq(uint8(status), uint8(state));
    }
}
