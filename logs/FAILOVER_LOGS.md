# Distributed Drawing Board - Failover Event Logs

## Initial Startup and Leader Election

```
replica3-1  | [2026-04-03T06:29:23.804Z] [replica3] [Term 0] [FOLLOWER] Election timeout - starting election 
replica3-1  | [2026-04-03T06:29:23.804Z] [replica3] [Term 0] [FOLLOWER] Becoming CANDIDATE 
replica3-1  | [2026-04-03T06:29:23.805Z] [replica3] [Term 1] [CANDIDATE] Starting election, need 2 votes 
replica1-1  | [2026-04-03T06:29:23.832Z] [replica1] [Term 0] [FOLLOWER] Received vote request from replica3
replica1-1  | [2026-04-03T06:29:23.832Z] [replica1] [Term 0] [FOLLOWER] Becoming FOLLOWER for term 1
replica1-1  | [2026-04-03T06:29:23.833Z] [replica1] [Term 1] [FOLLOWER] Granted vote to replica3 
replica2-1  | [2026-04-03T06:29:23.837Z] [replica2] [Term 0] [FOLLOWER] Received vote request from replica3
replica2-1  | [2026-04-03T06:29:23.837Z] [replica2] [Term 0] [FOLLOWER] Becoming FOLLOWER for term 1
replica2-1  | [2026-04-03T06:29:23.837Z] [replica2] [Term 1] [FOLLOWER] Granted vote to replica3 
replica3-1  | [2026-04-03T06:29:23.841Z] [replica3] [Term 1] [CANDIDATE] Election results: 3/3 votes 
replica3-1  | [2026-04-03T06:29:23.841Z] [replica3] [Term 1] [CANDIDATE] Becoming LEADER 
gateway-1   | [2026-04-03T06:29:23.855Z] [GATEWAY] Leader update received {"leaderId":"replica3","leaderUrl":"http://replica3:4003","term":1}
```

## Normal Stroke Replication (Append-Only Log)

```
gateway-1   | [2026-04-03T06:29:35.236Z] [GATEWAY] Received stroke from client
replica3-1  | [2026-04-03T06:29:35.252Z] [replica3] [Term 1] [LEADER] Received stroke from gateway
replica1-1  | [2026-04-03T06:29:35.255Z] [replica1] [Term 1] [FOLLOWER] Appended 1 entries, log size: 1 
replica2-1  | [2026-04-03T06:29:35.255Z] [replica2] [Term 1] [FOLLOWER] Appended 1 entries, log size: 1 
replica3-1  | [2026-04-03T06:29:35.255Z] [replica3] [Term 1] [LEADER] Replication complete: 3/3 acks 
gateway-1   | [2026-04-03T06:29:35.258Z] [GATEWAY] Broadcasting committed stroke
replica1-1  | [2026-04-03T06:29:35.269Z] [replica1] [Term 1] [FOLLOWER] Updated commitIndex to 1 
replica2-1  | [2026-04-03T06:29:35.269Z] [replica2] [Term 1] [FOLLOWER] Updated commitIndex to 1 
```

## Leader Failure and Re-Election (Failover Event)

```
# Leader (replica3) is killed
replica3-1  | [2026-04-03T06:32:35.612Z] [replica3] [Term 1] [LEADER] Received SIGTERM, shutting down gracefully 
replica3-1 exited with code 0

# Follower detects leader failure via election timeout
replica2-1  | [2026-04-03T06:32:36.226Z] [replica2] [Term 1] [FOLLOWER] Election timeout - starting election 
replica2-1  | [2026-04-03T06:32:36.227Z] [replica2] [Term 1] [FOLLOWER] Becoming CANDIDATE 
replica2-1  | [2026-04-03T06:32:36.227Z] [replica2] [Term 2] [CANDIDATE] Starting election, need 2 votes 

# Remaining follower grants vote
replica1-1  | [2026-04-03T06:32:36.249Z] [replica1] [Term 1] [FOLLOWER] Received vote request from replica2
replica1-1  | [2026-04-03T06:32:36.249Z] [replica1] [Term 1] [FOLLOWER] Becoming FOLLOWER for term 2
replica1-1  | [2026-04-03T06:32:36.249Z] [replica1] [Term 2] [FOLLOWER] Granted vote to replica2 

# New leader elected with majority (2/3 votes)
replica2-1  | [2026-04-03T06:32:36.553Z] [replica2] [Term 2] [CANDIDATE] Election results: 2/3 votes 
replica2-1  | [2026-04-03T06:32:36.553Z] [replica2] [Term 2] [CANDIDATE] Becoming LEADER 

# Gateway discovers new leader
gateway-1   | [2026-04-03T06:32:36.951Z] [GATEWAY] Lost connection to leader, discovering new leader 
gateway-1   | [2026-04-03T06:32:36.953Z] [GATEWAY] Found leader from replica1: replica2 
```

## Continued Operation After Failover

```
# Strokes continue to work with new leader (replica2)
gateway-1   | [2026-04-03T06:33:45.387Z] [GATEWAY] Received stroke from client
replica2-1  | [2026-04-03T06:33:45.391Z] [replica2] [Term 2] [LEADER] Received stroke from gateway
replica1-1  | [2026-04-03T06:33:45.394Z] [replica1] [Term 2] [FOLLOWER] Appended 1 entries, log size: 15 
replica2-1  | [2026-04-03T06:33:45.595Z] [replica2] [Term 2] [LEADER] Replication complete: 2/3 acks 
replica1-1  | [2026-04-03T06:33:45.708Z] [replica1] [Term 2] [FOLLOWER] Updated commitIndex to 15 
```

## Node Restart and Log Catch-up

```
# Replica3 restarts
replica3-1  | [2026-04-03T06:35:00.000Z] [replica3] [Term 0] [FOLLOWER] Starting on port 4003
replica3-1  | [2026-04-03T06:35:00.001Z] [replica3] [Term 0] [FOLLOWER] Loaded persisted state: term=1, commitIndex=14
replica3-1  | [2026-04-03T06:35:00.002Z] [replica3] [Term 0] [FOLLOWER] Loaded persisted log: 14 entries

# Leader sends missing entries
replica3-1  | [2026-04-03T06:35:00.150Z] [replica3] [Term 1] [FOLLOWER] Becoming FOLLOWER for term 2
replica3-1  | [2026-04-03T06:35:00.160Z] [replica3] [Term 2] [FOLLOWER] Sync-log request from replica2
replica3-1  | [2026-04-03T06:35:00.165Z] [replica3] [Term 2] [FOLLOWER] Synced log, now have 17 entries
replica3-1  | [2026-04-03T06:35:00.170Z] [replica3] [Term 2] [FOLLOWER] Updated commitIndex to 17

# Cluster back to full strength
replica2-1  | [2026-04-03T06:35:00.200Z] [replica2] [Term 2] [LEADER] Successfully synced replica3 from index 14
```

## Key Observations

1. **Election Timeout**: ~500-800ms random timeout prevents split votes
2. **Majority Quorum**: 2 of 3 nodes required for election and commits
3. **Term Monotonicity**: Term numbers only increase, never decrease
4. **Append-Only Log**: Entries are only appended, never modified
5. **Automatic Failover**: New leader elected within ~1 second of failure
6. **State Persistence**: Nodes recover state from disk on restart
7. **Log Catch-up**: Restarted nodes sync missing entries from leader
