// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice QoreChain's post-quantum verification and registered key precompiles.
interface IQorePQC {
    /// @notice Verify an ML-DSA-87 signature over raw bytes (2592-byte key, 4627-byte signature).
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// @notice Read the registered key and whether possession was proven. Algorithm 1 is ML-DSA-87.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

// A stolen classical key alone cannot authorize a notice for an account that
// already registered a proven PQ key. First registration can still be taken
// over before the owner registers. Anyone may relay a genuine signed action.

/// @title MoveNotice
/// @notice Public, time-locked account migration notices.
contract MoveNotice {
    /// @notice Current state of a move as seen by a reader.
    enum Status {
        NONE,
        PENDING,
        FINAL
    }

    /// @notice A target and its posting and activation times in Unix seconds.
    struct Move {
        address to;
        uint64 postedAt;
        uint64 effectiveAt;
    }

    /// @dev The protocol verifies signatures over the raw packed message.
    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    /// @dev The protocol supplies the current on-chain key for each account.
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    /// @notice Smallest configurable delay in seconds.
    uint64 public constant MIN_DELAY_FLOOR = 300;
    /// @notice Largest allowed notice delay in seconds.
    uint64 public constant MAX_DELAY = 30 days;
    /// @notice Smallest notice delay for this deployment in seconds.
    uint64 public immutable minDelay;

    /// @notice Most recent unmaterialized move. It may already be effective.
    mapping(address => Move) public pending;
    /// @notice Target of the last explicitly finalized move.
    mapping(address => address) public finalTo;
    /// @notice Nonce required for the next post or cancellation.
    mapping(address => uint256) public nonces;
    /// @dev Activation date of the stored final target.
    mapping(address => uint64) private finalEffectiveAt;

    /// @notice A relayer posted an authorized move using the supplied nonce.
    event MovePosted(
        address indexed account, address indexed to, uint256 nonce, uint64 postedAt, uint64 effectiveAt, address relayer
    );
    /// @notice A relayer cancelled an authorized move using the supplied nonce.
    event MoveCancelled(address indexed account, address indexed to, uint256 nonce, address relayer);
    /// @notice The effective move was materialized in storage.
    event MoveFinalized(address indexed account, address indexed to, uint64 effectiveAt);

    /// @notice The signature deadline has passed.
    error SignatureExpired();
    /// @notice The target is the zero address or the source account.
    error BadTarget();
    /// @notice The configured or requested delay is outside its bounds.
    error BadDelay();
    /// @notice The current notice must be cancelled or become effective first.
    error MovePending();
    /// @notice The account has no unmaterialized move.
    error NoPendingMove();
    /// @notice The move's cancellation period has ended.
    error AlreadyFinal();
    /// @notice The move's delay has yet to elapse.
    error NotYetEffective();
    /// @notice The account has no registered post-quantum key.
    error KeyNotRegistered();
    /// @notice The registered key lacks proof of possession.
    error KeyNotProven();
    /// @notice The registered key does not have the expected algorithm or length.
    error BadKey();
    /// @notice Verification of the action signature failed.
    error BadPqcSignature();

    /// @notice Set the minimum delay for all notices on this deployment.
    constructor(uint64 minDelay_) {
        if (minDelay_ < MIN_DELAY_FLOOR || minDelay_ > MAX_DELAY) revert BadDelay();
        minDelay = minDelay_;
    }

    /// @notice Return the exact bytes to sign for a post.
    function postMessage(address account, address to, uint64 delay, uint256 nonce, uint64 validUntil)
        public
        view
        returns (bytes memory)
    {
        return
            abi.encodePacked("MoveNotice:post:v1", block.chainid, address(this), account, to, delay, nonce, validUntil);
    }

    /// @notice Return the exact bytes to sign for a cancellation.
    function cancelMessage(address account, uint256 nonce, uint64 validUntil) public view returns (bytes memory) {
        return abi.encodePacked("MoveNotice:cancel:v1", block.chainid, address(this), account, nonce, validUntil);
    }

    /// @notice Relay an authorized move. An effective predecessor is materialized automatically.
    function postMove(address account, address to, uint64 delay, uint64 validUntil, bytes calldata mldsaSignature)
        external
    {
        if (block.timestamp > validUntil) revert SignatureExpired();
        if (to == address(0) || to == account) revert BadTarget();
        if (delay < minDelay || delay > MAX_DELAY) revert BadDelay();

        Move memory previous = pending[account];
        if (previous.to != address(0) && block.timestamp < previous.effectiveAt) revert MovePending();

        uint256 nonce = nonces[account];
        bytes memory key = _requireKey(account);
        if (!PQC_VERIFY.pqcVerify(key, mldsaSignature, postMessage(account, to, delay, nonce, validUntil))) {
            revert BadPqcSignature();
        }

        if (previous.to != address(0)) _finalize(account, previous);
        uint64 postedAt = uint64(block.timestamp);
        uint64 effectiveAt = postedAt + delay;
        nonces[account] = nonce + 1;
        pending[account] = Move(to, postedAt, effectiveAt);
        emit MovePosted(account, to, nonce, postedAt, effectiveAt, msg.sender);
    }

    /// @notice Relay an authorized cancellation before the effective timestamp.
    function cancelMove(address account, uint64 validUntil, bytes calldata mldsaSignature) external {
        if (block.timestamp > validUntil) revert SignatureExpired();
        Move memory move = pending[account];
        if (move.to == address(0)) revert NoPendingMove();
        if (block.timestamp >= move.effectiveAt) revert AlreadyFinal();

        uint256 nonce = nonces[account];
        bytes memory key = _requireKey(account);
        if (!PQC_VERIFY.pqcVerify(key, mldsaSignature, cancelMessage(account, nonce, validUntil))) {
            revert BadPqcSignature();
        }

        nonces[account] = nonce + 1;
        delete pending[account];
        emit MoveCancelled(account, move.to, nonce, msg.sender);
    }

    /// @notice Materialize an effective move for indexers. Reads already see it as final.
    function finalize(address account) external {
        Move memory move = pending[account];
        if (move.to == address(0)) revert NoPendingMove();
        if (block.timestamp < move.effectiveAt) revert NotYetEffective();
        _finalize(account, move);
    }

    /// @notice Resolve one hop, preserving the prior final target during a newer delay.
    function resolve(address account) public view returns (address to, Status status, uint64 effectiveAt) {
        Move memory move = pending[account];
        if (move.to != address(0) && block.timestamp >= move.effectiveAt) {
            return (move.to, Status.FINAL, move.effectiveAt);
        }
        address prior = finalTo[account];
        if (prior != address(0)) return (prior, Status.FINAL, finalEffectiveAt[account]);
        if (move.to != address(0)) return (move.to, Status.PENDING, move.effectiveAt);
        return (address(0), Status.NONE, 0);
    }

    /// @notice Follow up to eight final links, stopping before revisiting an address.
    function resolveFinal(address account) external view returns (address current, uint8 hops) {
        address[9] memory visited;
        current = account;
        visited[0] = account;
        while (hops < 8) {
            (address next, Status status,) = resolve(current);
            if (status != Status.FINAL) break;
            for (uint256 i; i <= hops; ++i) {
                if (visited[i] == next) return (current, hops);
            }
            current = next;
            visited[++hops] = next;
        }
    }

    /// @notice Check if a final move is in force.
    function isMoved(address account) external view returns (bool) {
        (, Status status,) = resolve(account);
        return status == Status.FINAL;
    }

    /// @notice Return the seconds remaining on the current pending record, or zero.
    function timeLeft(address account) external view returns (uint64) {
        Move memory move = pending[account];
        return block.timestamp < move.effectiveAt ? move.effectiveAt - uint64(block.timestamp) : 0;
    }

    /// @dev Fetch the key from the protocol and require proof of possession.
    function _requireKey(address account) private view returns (bytes memory key) {
        (bool registered, uint8 algorithm, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(account);
        if (!registered) revert KeyNotRegistered();
        if (!proven) revert KeyNotProven();
        if (algorithm != 1 || pubkey.length != 2592) revert BadKey();
        return pubkey;
    }

    /// @dev Store a final target and activation time, and clear the pending record.
    function _finalize(address account, Move memory move) private {
        finalTo[account] = move.to;
        finalEffectiveAt[account] = move.effectiveAt;
        delete pending[account];
        emit MoveFinalized(account, move.to, move.effectiveAt);
    }
}

/// @title GuardedPay
/// @notice Forward a native payment only when the recipient has no effective move.
contract GuardedPay {
    /// @notice The notice board used for this first check.
    MoveNotice public immutable notice;

    /// @notice The configured board has no contract code.
    error InvalidNoticeBoard();
    /// @notice The recipient moved. Review the suggested account before retrying.
    error AccountMoved(address to, address newAccount);
    /// @notice The recipient reverted or could not receive payment.
    error TransferFailed();

    /// @notice A payment forwarded to its original recipient.
    event Paid(address indexed sender, address indexed to, uint256 amount, bool movePending);

    /// @notice Set the notice board for all future checks.
    constructor(MoveNotice notice_) {
        if (address(notice_).code.length == 0) revert InvalidNoticeBoard();
        notice = notice_;
    }

    /// @notice Forward the full call value unless a final move is in force.
    function pay(address payable to) external payable {
        (address next, MoveNotice.Status status,) = notice.resolve(to);
        if (status == MoveNotice.Status.FINAL) revert AccountMoved(to, next);
        // Emit before calling the recipient so nested payments preserve entry order.
        // If the transfer fails, the revert rolls the event back.
        emit Paid(msg.sender, to, msg.value, status == MoveNotice.Status.PENDING);
        (bool success,) = to.call{value: msg.value}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Return whether payment can proceed, any suggested recipient, and the move status.
    function check(address to) external view returns (bool ok, address suggested, MoveNotice.Status status) {
        (suggested, status,) = notice.resolve(to);
        return (status != MoveNotice.Status.FINAL, suggested, status);
    }
}
