// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

interface MNDInterface {
    function callback(address, uint256, uint256, uint256) external;
}

contract Oracle {
    uint public requestId = 0;
    mapping(uint256 => bool) pendingRequests;
    event GetEvent(address mndAddress, uint requestId);
    MNDInterface obj;

    function receiveRequest() public returns (uint256) {
        requestId++;
        pendingRequests[requestId] = true;
        emit GetEvent(msg.sender, requestId);
        return requestId;
    }

    function returnRequest(
        address _clientNode,
        uint256 _mndId,
        uint256 _proofOfAvailabilityIndex,
        address _mndAddress,
        uint256 _requestId
    ) public {
        require(
            pendingRequests[_requestId],
            "This request is not in my pending list."
        );
        delete pendingRequests[_requestId];
        obj = MNDInterface(_mndAddress);
        obj.callback(_clientNode, _mndId, _proofOfAvailabilityIndex, _requestId);
    }
}
