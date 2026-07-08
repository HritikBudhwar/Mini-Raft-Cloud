# Architecture Document: Distributed Real-Time Drawing Board

## 1. System Overview

This is a **fault-tolerant, real-time collaborative drawing system** that implements a simplified RAFT consensus protocol (Mini-RAFT) for distributed state management across three replica nodes.

### Core Principles
- **Consistency**: All clients see the same canvas state
- **Availability**: System operates even if one replica fails
- **Partition Tolerance**: Handles network issues gracefully
- **Zero-Downtime**: Hot-reload capability without client disconnections

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Clients                          │
│  (Multiple Tabs/Windows - WebSocket Connections)            │
└────────────────┬─────────────────┬──────────────────────────┘
                 │                 │
                 │ WebSocket       │
                 │ (Browser API)   │
                 │                 │
        ┌────────▼─────────────────▼───────┐
        │                                  │
        │      Gateway Service             │
        │   (WebSocket Server & Broker)    │
        │                                  │
        │  - Maintain client connections   │
        │  - Route strokes to leader       │
        │  - Broadcast commits to clients  │
        │  - Leader discovery & failover   │
        │  - Port: 3000 (WebSocket: /draw) │
        │  - Ports: 4001-4003 (HTTP RPCs)  │
        │                                  │
        └────────┬────────────────────────┘
                 │
        ┌────────▼────────────────────────────────────────┐
        │                                                 │
        │          RAFT Consensus Cluster                │
        │                                                 │
        │  ┌──────────────┐  ┌──────────────┐            │
        │  │   Replica1   │  │   Replica2   │            │
        │  │  (4001)      │  │  (4002)      │            │
        │  │              │  │              │            │
        │  │ FOLLOWER or  │  │ FOLLOWER or  │            │
        │  │ LEADER       │  │ LEADER       │            │
        │  │              │  │              │            │
        │  │ ▼─ data/     │  │ ▼─ data/     │            │
        │  │   raft-log   │  │   raft-log   │            │
        │  │   raft-state │  │   raft-state │            │
        │  └──────────────┘  └──────────────┘            │
        │         │                 │                    │
        │         │ AppendEntries   │ RequestVote        │
        │         │ Heartbeat       │ SyncLog            │
        │         └────────┬────────┘                    │
        │                  │                            │
        │          ┌───────▼──────┐                    │
        │          │   Replica3   │                    │
        │          │  (4003)      │                    │
        │          │              │                    │
        │          │ FOLLOWER or  │                    │
        │          │ LEADER       │                    │
        │          │              │                    │
        │          │ ▼─ data/     │                    │
        │          │   raft-log   │                    │
        │          │   raft-state │                    │
        │          └──────────────┘                    │
        │                                                 │
        └─────────────────────────────────────────────────┘

Legend:
  ◄─►  HTTP REST API calls
  ───  State/Log files (persistent)
  ▼    Stored data directories
```

---

## 3. Component Responsibilities

### 3.1 Frontend (HTML5 Canvas)
**File:** `/frontend/index.html`

**Responsibilities:**
- Render drawing canvas
- Capture mouse/touch events
- Send drawing strokes to Gateway via WebSocket
- Receive and render remote strokes
- Display connection status
- Show current leader information

**Technologies:**
- HTML5 Canvas API
- WebSocket API
- Vanilla JavaScript

---

### 3.2 Gateway Service
**File:** `/gateway/server.js`

**Responsibilities:**
- WebSocket server for browser clients
- Forward strokes to current RAFT leader
- Broadcast committed strokes to all clients
- Automatic leader discovery and failover
- Client connection management
- Health monitoring of cluster

**Key Features:**
- Maintains `Map<clientId, WebSocket>` for connected clients
- Periodically polls `/state` endpoint of replicas to find leader
- Routes `/stroke` requests to `http://replica:PORT/stroke`
- Broadcasts `/commit-stroke` to all connected clients
- Zero client disconnections on leader change

**Port:** 3000

**Endpoints:**
- `POST /stroke` - Accept stroke from client
- `POST /commit-stroke` - Receive committed stroke from leader
- `POST /leader-update` - Leader notification
- `GET /health` - Health check
- `GET /status` - Cluster status
- `WS /draw` - WebSocket for client connections

---

### 3.3 Replica Nodes (Mini-RAFT Implementation)
**Files:** `/replica1/server.js`, `/replica2/server.js`, `/replica3/server.js`

All replicas are **identical** except for environment variables (NODE_ID, PORT, PEERS).

**Responsibilities:**
- Implement Mini-RAFT protocol
- Maintain stroke log
- Participate in leader election
- Replicate strokes from leader to followers
- Handle client stroke submissions (leader-only)
- Graceful hot-reload on file changes

**Port:** 4001, 4002, 4003 (respectively)

**Endpoints:**
- `POST /request-vote` - Vote request (election)
- `POST /append-entries` - Log replication
- `POST /heartbeat` - Heartbeat RPC (explicit endpoint)
- `POST /sync-log` - Catch-up synchronization
- `POST /stroke` - Client stroke (leader-only)
- `GET /state` - Node state information
- `GET /log` - Full log contents
- `GET /health` - Health check

---

## 4. Mini-RAFT Protocol Implementation

### 4.1 Node States

Each replica maintains one of three states:

```
┌─────────────────────────────────────────────────────────┐
│                   RAFT Node States                      │
└─────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   FOLLOWER   │
                    │              │
                    │ - Wait for   │
                    │   heartbeat  │
                    │ - Can vote   │
                    │ - Append     │
                    │   entries    │
                    └──────┬───────┘
                           │
                    Election Timeout
                    (500-800 ms random)
                           │
                           ▼
                    ┌──────────────┐
                    │  CANDIDATE   │
                    │              │
                    │ - Increment  │
                    │   term       │
                    │ - Request    │
                    │   votes      │
                    │ - Set        │
                    │   votedFor   │
                    └──────┬───────┘
                           │
                   ┌───────┴────────┐
                   │                │
            Receive Majority     Split Vote
            (≥2 of 3) Votes      (retry election)
                   │                │
                   ▼                ▼
        ┌──────────────────┐  (timeout again)
        │     LEADER       │
        │                  │
        │ - Send heartbeat │
        │   (150 ms)       │
        │ - Replicate logs │
        │ - Commit entries │
        │ - Notify Gateway │
        └──────┬───────────┘
               │
        Follower receives
        higher term or
        newer log
               │
               ▼
        ┌──────────────┐
        │   FOLLOWER   │
        └──────────────┘
```

**State Transitions:**
1. **FOLLOWER → CANDIDATE**
   - Trigger: Election timeout (500-800ms without heartbeat)
   - Action: Increment term, request votes

2. **CANDIDATE → LEADER**
   - Trigger: Receive ≥2 votes (majority)
   - Action: Send heartbeats, start replication

3. **CANDIDATE → FOLLOWER**
   - Trigger: Receive vote response with higher term
   - Action: Reset term, clear votedFor

4. **LEADER → FOLLOWER**
   - Trigger: Receive AppendEntries from higher term
   - Action: Step down, accept new leader

---

### 4.2 Persistent State

Each replica saves state to disk:

**File:** `/data/raft-state.json`
```json
{
  "currentTerm": 5,
  "votedFor": "replica2",
  "commitIndex": 42
}
```

**File:** `/data/raft-log.json`
```json
[
  {
    "term": 1,
    "index": 1,
    "stroke": { "id": "stroke-1", "color": "#ff0000", "points": [...] }
  },
  {
    "term": 2,
    "index": 2,
    "stroke": { "id": "stroke-2", "color": "#00ff00", "points": [...] }
  },
  ...
]
```

**On Startup:**
- Load persisted state and log
- Validate state (term, votedFor, commitIndex)
- Start as FOLLOWER
- Wait 500-800ms before starting election (allows leader heartbeat)

---

### 4.3 Election Protocol

**Trigger:** Election timeout on a FOLLOWER

**Process:**
```
FOLLOWER (term=T, votedFor=null)
    │
    ├─► Increment term to T+1
    ├─► Set votedFor = self
    ├─► Start CANDIDATE
    │
    ├─► Send RequestVote RPC to all peers:
    │   {
    │     term: T+1,
    │     candidateId: "replica1",
    │     lastLogIndex: 42,
    │     lastLogTerm: 5
    │   }
    │
    └─► Collect responses (with timeout)
        │
        ├─► If receive ≥2 votes (majority):
        │   ├─► Become LEADER
        │   ├─► Send heartbeats to all followers
        │   └─► Notify gateway of leadership
        │
        └─► If receive vote response with higher term:
            └─► Become FOLLOWER (reset)
```

**Vote Grant Rules:**
```
RequestVote received:
  │
  ├─ If term > currentTerm:
  │  └─► Update term, reset votedFor
  │
  ├─ If term == currentTerm AND (votedFor == null OR votedFor == candidateId):
  │  └─► Check log currency:
  │      ├─ If lastLogTerm > ourLastLogTerm:
  │      │  └─► GRANT vote (candidate has newer entries)
  │      │
  │      └─ If lastLogTerm == ourLastLogTerm AND lastLogIndex >= ourLastLogIndex:
  │         └─► GRANT vote (candidate's log is at least as up-to-date)
  │
  └─ Otherwise:
     └─► DENY vote
```

**Election Timeout:** 500-800ms (random, prevents simultaneous elections)

**Split Vote Handling:**
- Multiple candidates receive no majority
- Timeouts occur, elections retry
- Eventually one candidate wins (randomization ensures this)

---

### 4.4 Log Replication

**Stroke Submission Flow:**
```
Client (Browser)
  │ WebSocket
  ▼
Gateway
  │ POST /stroke
  ▼
Leader Replica (only)
  │
  ├─► 1. Append to local log
  │      log.push({term: currentTerm, stroke: data})
  │
  ├─► 2. Send AppendEntries to followers:
  │      POST /append-entries
  │      {
  │        term: currentTerm,
  │        leaderId: "replica1",
  │        prevLogIndex: 41,
  │        prevLogTerm: 5,
  │        entries: [{term: 5, stroke: ...}],
  │        leaderCommit: 40
  │      }
  │
  ├─► 3. Followers:
  │      ├─ Validate prevLogIndex/prevLogTerm
  │      ├─ Append entries if valid
  │      └─ Reply { term, success }
  │
  ├─► 4. Leader receives responses:
  │      ├─ Count acknowledgments (acks)
  │      └─ If acks ≥ majority (2 of 3):
  │         ├─ Mark entry as committed
  │         ├─ Update commitIndex
  │         └─ Send POST /commit-stroke to Gateway
  │
  └─► 5. Gateway:
      ├─ Receives committed stroke
      ├─ Broadcasts to all clients
      └─ Clients render on canvas
```

**Log Safety Rules:**
1. **Append-Only**: Entries never modified, only appended
2. **No Gaps**: Index is contiguous (1, 2, 3, ...)
3. **Term Monotonicity**: Term only increases or stays same
4. **Committed Safety**: Committed entries never overwritten

---

### 4.5 Catch-Up Synchronization (Rejoin Protocol)

When a restarted node rejoins:

**Scenario:**
```
Replica1 (restarted):
  Load: state = {term: 3, commitIndex: 40}
  Load: log = [entry1, entry2, ..., entry40]
  
Leader has:
  log = [entry1, entry2, ..., entry50]

Problem: Replica1 is missing entries 41-50
```

**Solution - Sync-Log RPC:**

```
Replica1 (FOLLOWER)
  │
  ├─► Receive AppendEntries from Leader
  │   prevLogIndex = 50
  │   prevLogTerm = 4
  │
  ├─► Check: Do we have entry 50?
  │   │ No, our log only has 40 entries
  │   │
  │   └─► Reply: {success: false, conflictIndex: 40}
  │
  │
  └─► Leader receives reply
      │
      ├─► Detect log mismatch
      └─► Call POST /sync-log
          {
            term: 4,
            leaderId: "replica1",
            fromIndex: 41,
            entries: [entry41, entry42, ..., entry50],
            leaderCommit: 50
          }
```

**Replica1 (catch-up):**
```
Receive /sync-log:
  │
  ├─► Remove entries from index 41 onward
  ├─► Append new entries (41-50)
  ├─► Save log to disk
  ├─► Update commitIndex to 50
  ├─► Save state to disk
  │
  └─► Reply: {success: true}
      
Now in sync and participates normally
```

---

## 5. Hot-Reload Implementation

### 5.1 Volume Mount Setup
```yaml
replica1:
  volumes:
    - ./replica1:/app           # Host folder → Container /app
    - ./replica1/data:/data     # Persistent log/state
    - /app/node_modules         # Named volume for dependencies
```

When a file on the host is modified:
- Docker detects change
- nodemon (inside container) detects file change
- Process restarts with new code

### 5.2 Graceful Shutdown
```javascript
// On SIGTERM (from docker restart)
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down gracefully');
  stopHeartbeat();      // Stop sending heartbeats
  stopElectionTimeout();  // Stop election timer
  process.exit(0);      // Exit cleanly
});
```

### 5.3 Rejoin on Restart
```
1. Node restarts (via nodemon hot-reload)
   └─► Loads persisted state from disk

2. New process starts
   └─► Waits 500-800ms before joining (allows leader heartbeat)

3. Receives AppendEntries from current leader
   └─► Updates term, becomes FOLLOWER

4. If log is behind, syncs via /sync-log

5. Participates in cluster normally

Result: No client disconnections, no data loss
```

### 5.4 Unbuffered Logging Fix

**Issue:** Logs from restarted processes were buffered

**Solution:** Two-part fix:
1. **Dockerfile**: `stdbuf -o0` at container startup
2. **nodemon.json**: `"exec": "stdbuf -o0 node"` for child processes

**Result:** Logs appear immediately in `docker-compose logs -f`

---

## 6. Data Flow Diagrams

### 6.1 Normal Stroke Submission
```
Browser Client
     │
     ├─► Canvas: onmousemove event
     │   └─► captureStroke({x, y, color})
     │
     └─► WebSocket → Gateway
         └─► {type: "stroke", stroke: {...}}
             
Gateway
     │
     ├─► Discover current leader
     │   └─► GET http://replica1:4001/state
     │       └─► {role: "leader", term: 5}
     │
     └─► POST http://replica1:4001/stroke
         └─► {stroke: {...}}

Leader (Replica1)
     │
     ├─► Append to log
     │   state.log.push({term: 5, stroke: {...}})
     │
     ├─► Replicate: POST /append-entries to followers
     │   ├─► Replica2: {term: 5, entries: [...]}
     │   └─► Replica3: {term: 5, entries: [...]}
     │
     ├─► Followers append and reply {success: true}
     │
     ├─► Leader counts: 3 acks (majority reached)
     │
     ├─► Mark committed: commitIndex++
     │
     └─► Notify Gateway: POST /commit-stroke
         └─► {stroke: {...}, index: 42}

Gateway
     │
     └─► Broadcast to all clients: {type: "stroke", stroke: {...}}
         
All Browsers
     │
     └─► Render stroke on canvas
```

### 6.2 Leader Election After Failure
```
Current: Replica1 is LEADER (term 5)

Failure Event: Replica1 dies (docker kill)
     │
     ├─► Gateway notices leader unresponsive (timeout)
     │   └─► Sets currentLeader = null
     │
     └─► Replicas 2 & 3:
         ├─► Miss heartbeat from leader (>800ms)
         └─► Election timeout triggered

Replica2 (term 5)
     │
     ├─► Election timeout fired
     ├─► Increment term → 6
     ├─► Set votedFor = replica2
     ├─► Become CANDIDATE
     │
     ├─► Send RequestVote to Replica3:
     │   {term: 6, candidateId: replica2, lastLogIndex: 42, lastLogTerm: 5}
     │
     └─► Receive response from Replica3:
         {term: 6, voteGranted: true}
         
Count: 2 votes (self + replica3) = MAJORITY
     │
     ├─► Become LEADER
     ├─► Send heartbeat to followers
     │
     └─► Send leader-update to Gateway:
         POST /leader-update
         {leaderId: "replica2", leaderUrl: "http://replica2:4002", term: 6}

Gateway
     │
     ├─► Update: currentLeader = replica2
     ├─► Broadcast to all clients:
     │   {type: "leader-change", leader: "replica2", term: 6}
     │
     └─► Route new strokes to replica2

All Browsers
     │
     └─► Show status: "Leader: replica2 (Term 6)"
```

---

## 7. API Specifications

### 7.1 RequestVote RPC

**Request (POST /request-vote):**
```json
{
  "term": 6,
  "candidateId": "replica2",
  "lastLogIndex": 42,
  "lastLogTerm": 5
}
```

**Response:**
```json
{
  "term": 6,
  "voteGranted": true
}
```

---

### 7.2 AppendEntries RPC

**Request (POST /append-entries):**
```json
{
  "term": 5,
  "leaderId": "replica1",
  "prevLogIndex": 41,
  "prevLogTerm": 5,
  "entries": [
    {"term": 5, "index": 42, "stroke": {...}}
  ],
  "leaderCommit": 41
}
```

**Response:**
```json
{
  "term": 5,
  "success": true,
  "conflictIndex": null
}
```

---

### 7.3 Heartbeat RPC

**Request (POST /heartbeat):**
```json
{
  "term": 5,
  "leaderId": "replica1",
  "leaderCommit": 41
}
```

**Response:**
```json
{
  "term": 5,
  "success": true
}
```

**Note:** This is an explicit heartbeat endpoint. The system also supports heartbeats through `/append-entries` with empty entries, but this endpoint provides explicit heartbeat semantics.

---

### 7.4 Sync-Log RPC (Catch-Up)

**Request (POST /sync-log):**
```json
{
  "term": 5,
  "leaderId": "replica1",
  "fromIndex": 40,
  "entries": [
    {"term": 5, "index": 40, "stroke": {...}},
    {"term": 5, "index": 41, "stroke": {...}}
  ],
  "leaderCommit": 41
}
```

**Response:**
```json
{
  "term": 5,
  "success": true
}
```

---

### 7.5 Stroke Submission (Leader Only)

**Request (POST /stroke):**
```json
{
  "stroke": {
    "id": "stroke-abc123",
    "color": "#FF0000",
    "width": 2,
    "points": [[10, 20], [11, 21], [12, 22]]
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "index": 42
}
```

**Response (Not Leader):**
```json
{
  "error": "Not leader",
  "leaderId": "replica1",
  "leaderUrl": "http://replica1:4001"
}
```

---

### 7.6 State Query

**Request (GET /state):**
```
No request body
```

**Response:**
```json
{
  "nodeId": "replica1",
  "role": "leader",
  "term": 5,
  "leaderId": "replica1",
  "logLength": 42,
  "commitIndex": 41,
  "votedFor": "replica1",
  "peers": ["http://replica2:4002", "http://replica3:4003"]
}
```

---

## 8. Failure Scenarios & Handling

### 8.1 Single Node Failure
**Scenario:** Kill replica1 (leader)

**Behavior:**
- Gateway detects leader unresponsive (timeout)
- Replicas 2 & 3 detect missing heartbeat
- Election held between 2 & 3
- New leader elected
- Gateway routes to new leader
- System continues operating

**Recovery:**
- Restart replica1: `docker-compose start replica1`
- Replica1 loads persisted state, becomes follower
- Catches up via sync-log if behind
- Participates in next election cycle

---

### 8.2 Network Partition
**Scenario:** Temporary network split

**Behavior:**
- Separated nodes cannot communicate
- Both sides hold elections
- Smaller partition: Candidate cannot reach majority, stays candidate
- Larger partition (2+ nodes): Elects leader
- System continues in majority partition only
- Minority partition cannot commit (no quorum)

**Recovery:**
- Network heals
- Partitions merge
- Higher term numbers win
- Sync-log catches minorities up

---

### 8.3 Simultaneous Failures
**Scenario:** Two nodes fail simultaneously

**Behavior:**
- Last remaining replica (1 of 3) cannot reach majority
- Cannot become leader
- System is unavailable for writes
- Reads still possible (from remaining replica)

**Recovery:**
- Restart any failed replica
- Quorum restored (2 of 3)
- Leader election or existing leader remains
- System back online

---

### 8.4 Long-Running Partition
**Scenario:** One node isolated for 60+ seconds

**Behavior:**
- Isolated node continues running
- Cannot receive updates from leader
- Log falls behind
- When rejoined, receives sync-log with all missing entries
- Catches up to commit index

---

## 9. Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Election Timeout | 500-800ms | Random to prevent split votes |
| Heartbeat Interval | 150ms | 3-5x shorter than election timeout |
| Leader Discovery | ~1000ms | Periodic polling by gateway |
| Stroke Latency | <100ms | With ≥2 follower acks |
| Failover Time | ~1-2s | Election + gateway discovery |
| Sync-Log Speed | Variable | Depends on log size |

---

## 10. Security Considerations

**Current Implementation (Educational):**
- No authentication required
- All HTTP endpoints publicly accessible
- WebSocket connections unrestricted

**For Production:**
- Add JWT authentication
- Implement RBAC (Role-Based Access Control)
- Use TLS for all connections
- Rate limiting on endpoints
- Input validation on stroke data

---

## 11. Monitoring & Observability

**Logging:**
Every log line includes:
- ISO timestamp
- Node ID
- Current term
- Current role (FOLLOWER/CANDIDATE/LEADER)
- Log message

**Example:**
```
[2026-04-17T10:30:45.123Z] [replica1] [Term 5] [LEADER] Appended 1 entries, log size: 42
```

**Monitoring Endpoints:**
- `GET http://localhost:3000/health` - Gateway health
- `GET http://localhost:3000/status` - Full cluster status
- `GET http://localhost:4001/state` - Individual replica state
- `docker-compose logs -f` - Unified log stream

---

## 12. Conclusion

This architecture delivers:

✅ **Fault Tolerance** - Handles 1-of-3 node failures  
✅ **Consistency** - RAFT consensus ensures identical state  
✅ **Availability** - Zero-downtime hot-reload  
✅ **Real-Time** - WebSocket-based low-latency updates  
✅ **Scalability** - Modular design supports adding replicas  
✅ **Observability** - Comprehensive logging and monitoring  

The system is suitable for production demonstration and evaluation.
