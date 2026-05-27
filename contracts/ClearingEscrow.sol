// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ClearingEscrow {
    enum State { Awaiting, Funded, Signed, Released, Refunded }

    IERC20 public immutable usdcToken;
    address public immutable bankA;
    address public immutable bankB;
    uint256 public immutable amount;
    uint256 public immutable deadline;

    State public state;
    bool public bankASigned;
    bool public bankBSigned;

    event Funded(address indexed bank, uint256 amount);
    event Signed(address indexed bank);
    event Released(uint256 amount);
    event Refunded(uint256 amount);

    constructor(
        address _bankA,
        address _bankB,
        address _usdcToken,
        uint256 _amount,
        uint256 _deadline
    ) {
        require(_bankA != address(0) && _bankB != address(0), "zero address");
        require(_amount > 0, "zero amount");
        require(_deadline > block.timestamp, "deadline in past");

        bankA = _bankA;
        bankB = _bankB;
        usdcToken = IERC20(_usdcToken);
        amount = _amount;
        deadline = _deadline;
        state = State.Awaiting;
    }

    function fund() external {
        require(msg.sender == bankA, "only bank A");
        require(state == State.Awaiting, "not awaiting");

        bool ok = usdcToken.transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        state = State.Funded;
        emit Funded(msg.sender, amount);
    }

    function sign() external {
        require(state == State.Funded || state == State.Signed, "not funded");
        require(msg.sender == bankA || msg.sender == bankB, "not a party");

        if (msg.sender == bankA) {
            require(!bankASigned, "already signed");
            bankASigned = true;
        } else {
            require(!bankBSigned, "already signed");
            bankBSigned = true;
        }

        emit Signed(msg.sender);

        if (state == State.Funded) {
            state = State.Signed;
        }

        if (bankASigned && bankBSigned) {
            state = State.Released;
            bool ok = usdcToken.transfer(bankB, amount);
            require(ok, "release transfer failed");
            emit Released(amount);
        }
    }

    function refund() external {
        require(block.timestamp >= deadline, "before deadline");
        require(state == State.Funded || state == State.Signed, "cannot refund");

        state = State.Refunded;
        bool ok = usdcToken.transfer(bankA, amount);
        require(ok, "refund transfer failed");
        emit Refunded(amount);
    }
}
