// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MoveNotice} from "../src/MoveNotice.sol";
import {MockPqc} from "./helpers/MockPqc.sol";

abstract contract NoticeFixture is Test {
    address internal constant VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant KEYS = 0x0000000000000000000000000000000000000a02;
    uint64 internal constant START = 1_800_000_000;
    uint64 internal constant DELAY = 600;
    uint64 internal constant EXPIRY = START + 3600;
    address internal constant A = address(0xa11ce);
    address internal constant B = address(0xb0b);
    address internal constant C = address(0xca201);

    MoveNotice internal notice;
    bytes internal key;
    bytes internal otherKey;

    function setUp() public virtual {
        vm.warp(START);
        vm.chainId(9800);
        MockPqc mock = new MockPqc();
        vm.etch(VERIFY, address(mock).code);
        vm.etch(KEYS, address(mock).code);
        key = new bytes(2592);
        key[0] = 0x01;
        otherKey = new bytes(2592);
        otherKey[0] = 0x02;
        _register(A);
        notice = new MoveNotice(DELAY);
    }

    function _register(address account) internal {
        MockPqc(KEYS).setKey(account, key, true, true, 1);
    }

    function _sign(bytes memory signingKey, bytes memory message) internal pure returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked("ok", signingKey, message)));
    }

    function _postSig(address from, address to, uint64 delay) internal view returns (bytes memory) {
        return _sign(key, notice.postMessage(from, to, delay, notice.nonces(from), EXPIRY));
    }

    function _cancelSig(address from) internal view returns (bytes memory) {
        return _sign(key, notice.cancelMessage(from, notice.nonces(from), EXPIRY));
    }

    function _post(address from, address to) internal {
        notice.postMove(from, to, DELAY, EXPIRY, _postSig(from, to, DELAY));
    }

    function _cancel(address from) internal {
        notice.cancelMove(from, EXPIRY, _cancelSig(from));
    }

    function _resolved(address from, address to, MoveNotice.Status status, uint64 effectiveAt) internal view {
        (address actual, MoveNotice.Status state, uint64 time) = notice.resolve(from);
        assertEq(actual, to);
        assertEq(uint8(state), uint8(status));
        assertEq(time, effectiveAt);
        assertEq(notice.isMoved(from), status == MoveNotice.Status.FINAL);
    }
}

contract MoveNoticeTest is NoticeFixture {
    function test_postMove_valid() public {
        bytes memory sig = _postSig(A, B, DELAY);
        vm.expectEmit(true, true, false, true, address(notice));
        emit MoveNotice.MovePosted(A, B, 0, START, START + DELAY, address(this));
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        (address to, uint64 postedAt, uint64 effectiveAt) = notice.pending(A);
        assertEq(to, B);
        assertEq(postedAt, START);
        assertEq(effectiveAt, START + DELAY);
        assertEq(notice.nonces(A), 1);
        assertEq(notice.timeLeft(A), DELAY);
        _resolved(A, B, MoveNotice.Status.PENDING, START + DELAY);
    }

    function test_postMove_badSignature_reverts() public {
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY, hex"1234");
    }

    function test_classicalKeyOnlyAttacker_cannotPost() public {
        bytes memory sig = _sign(otherKey, notice.postMessage(A, B, DELAY, 0, EXPIRY));
        vm.startPrank(A);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY, "");
        vm.stopPrank();
        assertEq(notice.nonces(A), 0);
    }

    function test_classicalKeyOnlyAttacker_cannotCancel() public {
        _post(A, B);
        bytes memory sig = _sign(otherKey, notice.cancelMessage(A, 1, EXPIRY));
        vm.startPrank(A);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.cancelMove(A, EXPIRY, sig);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.cancelMove(A, EXPIRY, "");
        vm.stopPrank();
        _resolved(A, B, MoveNotice.Status.PENDING, START + DELAY);
    }

    function test_anyoneCanRelayAValidSignature() public {
        address relayer = makeAddr("independent relayer");
        bytes memory sig = _postSig(A, B, DELAY);
        vm.prank(relayer);
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        _resolved(A, B, MoveNotice.Status.PENDING, START + DELAY);
    }

    function test_cancel_insideDelay() public {
        _post(A, B);
        bytes memory sig = _cancelSig(A);
        vm.warp(START + DELAY - 1);
        vm.expectEmit(true, true, false, true, address(notice));
        emit MoveNotice.MoveCancelled(A, B, 1, address(this));
        notice.cancelMove(A, EXPIRY, sig);
        _resolved(A, address(0), MoveNotice.Status.NONE, 0);
        assertEq(notice.nonces(A), 2);
        assertEq(notice.timeLeft(A), 0);
    }

    function test_cancel_afterEffective_reverts() public {
        _post(A, B);
        bytes memory sig = _cancelSig(A);
        vm.warp(START + DELAY);
        vm.expectRevert(MoveNotice.AlreadyFinal.selector);
        notice.cancelMove(A, EXPIRY, sig);
    }

    function test_replay_samePostSignature_reverts() public {
        bytes memory sig = _postSig(A, B, DELAY);
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        _cancel(A);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY, sig);
    }

    function test_replay_otherContract_reverts() public {
        MoveNotice other = new MoveNotice(DELAY);
        bytes memory sig = _postSig(A, B, DELAY);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        other.postMove(A, B, DELAY, EXPIRY, sig);
    }

    function test_replay_otherChain_reverts() public {
        bytes memory sig = _postSig(A, B, DELAY);
        vm.chainId(1);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY, sig);
    }

    function test_signatureBindsActionTargetDelayAndExpiry() public {
        bytes memory sig = _postSig(A, B, DELAY);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, C, DELAY, EXPIRY, sig);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY + 1, EXPIRY, sig);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.postMove(A, B, DELAY, EXPIRY + 1, sig);
        _post(A, B);
        bytes memory wrongAction = _postSig(A, C, DELAY);
        vm.expectRevert(MoveNotice.BadPqcSignature.selector);
        notice.cancelMove(A, EXPIRY, wrongAction);
    }

    function test_expiredSignature_reverts() public {
        vm.warp(EXPIRY + 1);
        vm.expectRevert(MoveNotice.SignatureExpired.selector);
        notice.postMove(A, address(0), 0, EXPIRY, "");
        vm.expectRevert(MoveNotice.SignatureExpired.selector);
        notice.cancelMove(A, EXPIRY, "");
    }

    function test_resolve_afterFinalize() public {
        _post(A, B);
        vm.warp(START + DELAY);
        _resolved(A, B, MoveNotice.Status.FINAL, START + DELAY);
        assertEq(notice.finalTo(A), address(0));
        vm.expectEmit(true, true, false, true, address(notice));
        emit MoveNotice.MoveFinalized(A, B, START + DELAY);
        notice.finalize(A);
        _resolved(A, B, MoveNotice.Status.FINAL, START + DELAY);
        assertEq(notice.finalTo(A), B);
        assertEq(notice.nonces(A), 1);
        (address pendingTarget,,) = notice.pending(A);
        assertEq(pendingTarget, address(0));
    }

    function test_finalizeRequiresAnEffectiveMove() public {
        vm.expectRevert(MoveNotice.NoPendingMove.selector);
        notice.finalize(A);
        vm.expectRevert(MoveNotice.NoPendingMove.selector);
        notice.cancelMove(A, EXPIRY, "");
        _post(A, B);
        vm.expectRevert(MoveNotice.NotYetEffective.selector);
        notice.finalize(A);
    }

    function test_newNoticeBlockedWhilePending() public {
        _post(A, B);
        vm.expectRevert(MoveNotice.MovePending.selector);
        notice.postMove(A, C, DELAY, EXPIRY, "");
    }

    function test_newNoticeAfterFinal_keepsOldFinalUntilNewFinal() public {
        _post(A, B);
        vm.warp(START + DELAY);
        bytes memory sig = _postSig(A, C, DELAY);
        vm.expectEmit(true, true, false, true, address(notice));
        emit MoveNotice.MoveFinalized(A, B, START + DELAY);
        notice.postMove(A, C, DELAY, EXPIRY, sig);
        _resolved(A, B, MoveNotice.Status.FINAL, START + DELAY);
        assertEq(notice.timeLeft(A), DELAY);
        vm.warp(START + 2 * DELAY);
        _resolved(A, C, MoveNotice.Status.FINAL, START + 2 * DELAY);
    }

    function test_cancelSuccessorPreservesFinal() public {
        _post(A, B);
        vm.warp(START + DELAY);
        _post(A, C);
        _cancel(A);
        _resolved(A, B, MoveNotice.Status.FINAL, START + DELAY);
    }

    function test_delayBelowMinimum_reverts() public {
        vm.expectRevert(MoveNotice.BadDelay.selector);
        notice.postMove(A, B, DELAY - 1, EXPIRY, "");
    }

    function test_delayAboveMax_reverts() public {
        uint64 delay = notice.MAX_DELAY() + 1;
        vm.expectRevert(MoveNotice.BadDelay.selector);
        notice.postMove(A, B, delay, EXPIRY, "");
    }

    function test_constructor_rejectsDelayBelowFloor() public {
        vm.expectRevert(MoveNotice.BadDelay.selector);
        new MoveNotice(299);
    }

    function test_constructor_rejectsAboveMaximum() public {
        vm.expectRevert(MoveNotice.BadDelay.selector);
        new MoveNotice(30 days + 1);
    }

    function test_badTarget_zeroOrSelf_reverts() public {
        vm.expectRevert(MoveNotice.BadTarget.selector);
        notice.postMove(A, address(0), DELAY, EXPIRY, "");
        vm.expectRevert(MoveNotice.BadTarget.selector);
        notice.postMove(A, A, DELAY, EXPIRY, "");
    }

    function test_keyNotRegistered_reverts() public {
        vm.expectRevert(MoveNotice.KeyNotRegistered.selector);
        notice.postMove(C, B, DELAY, EXPIRY, "");
    }

    function test_keyNotProven_reverts() public {
        MockPqc(KEYS).setKey(A, key, true, false, 1);
        vm.expectRevert(MoveNotice.KeyNotProven.selector);
        notice.postMove(A, B, DELAY, EXPIRY, "");
    }

    function test_wrongAlgorithm_reverts() public {
        MockPqc(KEYS).setKey(A, key, true, true, 2);
        vm.expectRevert(MoveNotice.BadKey.selector);
        notice.postMove(A, B, DELAY, EXPIRY, "");
    }

    function test_wrongKeyLength_reverts() public {
        MockPqc(KEYS).setKey(A, hex"01", true, true, 1);
        vm.expectRevert(MoveNotice.BadKey.selector);
        notice.postMove(A, B, DELAY, EXPIRY, "");
    }

    function test_precompileInactive_reverts() public {
        bytes memory sig = _postSig(A, B, DELAY);
        vm.etch(KEYS, "");
        vm.expectRevert();
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        _registerAfterRestoring();
        vm.etch(VERIFY, "");
        vm.expectRevert();
        notice.postMove(A, B, DELAY, EXPIRY, sig);
        assertEq(notice.nonces(A), 0);
    }

    function _registerAfterRestoring() private {
        vm.etch(KEYS, VERIFY.code);
        _register(A);
    }

    function test_resolveFinal_followsChain_and_stopsOnCycle() public {
        _register(B);
        _register(C);
        _post(A, B);
        _post(B, C);
        vm.warp(START + DELAY);
        (address target, uint8 hops) = notice.resolveFinal(A);
        assertEq(target, C);
        assertEq(hops, 2);
        _post(C, A);
        vm.warp(START + 2 * DELAY);
        (target, hops) = notice.resolveFinal(A);
        assertEq(target, C);
        assertEq(hops, 2);
    }

    function test_resolveFinal_capsHopsAtEight() public {
        for (uint160 i = 1; i <= 9; ++i) {
            _register(address(i));
            _post(address(i), address(i + 1));
        }
        vm.warp(START + DELAY);
        (address target, uint8 hops) = notice.resolveFinal(address(1));
        assertEq(target, address(9));
        assertEq(hops, 8);
    }

    function test_messageLayout_goldenVector() public {
        address fixedAddress = 0x3333333333333333333333333333333333333333;
        vm.etch(fixedAddress, address(notice).code);
        MoveNotice fixedNotice = MoveNotice(fixedAddress);
        assertEq(
            fixedNotice.postMessage(
                0x1111111111111111111111111111111111111111,
                0x2222222222222222222222222222222222222222,
                600,
                7,
                1_800_000_000
            ),
            hex"4d6f76654e6f746963653a706f73743a7631000000000000000000000000000000000000000000000000000000000000264833333333333333333333333333333333333333331111111111111111111111111111111111111111222222222222222222222222222222222222222200000000000002580000000000000000000000000000000000000000000000000000000000000007000000006b49d200"
        );
        assertEq(
            fixedNotice.cancelMessage(0x1111111111111111111111111111111111111111, 7, 1_800_000_000),
            hex"4d6f76654e6f746963653a63616e63656c3a76310000000000000000000000000000000000000000000000000000000000002648333333333333333333333333333333333333333311111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000007000000006b49d200"
        );
    }

    function testFuzz_postWarpResolve(uint64 input, address relayer) public {
        uint64 delay = uint64(bound(input, DELAY, notice.MAX_DELAY()));
        bytes memory sig = _postSig(A, B, delay);
        vm.prank(relayer);
        notice.postMove(A, B, delay, EXPIRY, sig);
        _resolved(A, B, MoveNotice.Status.PENDING, START + delay);
        vm.warp(START + delay);
        _resolved(A, B, MoveNotice.Status.FINAL, START + delay);
    }
}
