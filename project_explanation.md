# Distributed Drawing Board Project - Complete Explanation

## 📋 Table of Contents
1. [File Structure & Purposes](#file-structure--purposes)
2. [Why Each File is Necessary](#why-each-file-is-necessary)
3. [High-Level Architecture](#high-level-architecture)
4. [Detailed Technical Architecture](#detailed-technical-architecture)
5. [RAFT Consensus Protocol Implementation](#raft-consensus-protocol-implementation)
6. [Data Flow & Examples](#data-flow--examples)
7. [Fault Tolerance & Failover Mechanism](#fault-tolerance--failover-mechanism)
8. [Possible Teacher Questions & Answers](#possible-teacher-questions--answers)

---

## File Structure & Purposes

### Root Level Files

#### `docker-compose.yml`
- **Purpose**: Orchestrates all services (frontend, gateway, replicas) using Docker containers
- **Contains**: Service definitions, port mappings, environment variables, volume mounts, network configuration
- **Key Role**: Single command (`docker-compose up`) starts the entire distributed system

#### `README.md`
- **Purpose**: Project documentation for users and developers
- **Contains**: Quick start guide, access points, testing failover procedures, architecture overview
- **Key Role**: Helps understand project scope and how to run/test it

---

### Frontend Directory (`/frontend`)

#### `frontend/index.html`
- **Purpose**: The user interface - a real-time collaborative drawing canvas
- **Contains**: 
  - HTML5 Canvas for drawing
  - WebSocket client to connect to gateway
  - Color picker, brush size selector
  - Real-time UI for displaying cluster status (current leader, term number)
  - Event handlers for mouse events (draw-start, draw-point, draw-end)
- **Key Role**: 
  - Primary user interaction point
  - Sends drawing strokes to the system
  - Receives and displays committed strokes from all users
  - Shows system health status (leader, active clients)

**Why it's necessary**: Without the UI, users cannot interact with the drawing system. It's the entry point for all client applications.

#### `frontend/Dockerfile`
- **Purpose**: Container image definition for the frontend service
- **Contains**: 
  - Nginx web server base image (lightweight, fast)
  - Copies `index.html` and `nginx.conf` into container
- **Key Role**: Packages the frontend into a reproducible container for deployment

**Why it's necessary**: Enables containerization and ensures consistent deployment across environments (dev, test, production).

#### `frontend/nginx.conf`
- **Purpose**: Configuration for Nginx web server
- **Contains**: 
  - Server block listening on port 80
  - Serve static files from `/usr/share/nginx/html`
  - Proxy configurations (if needed)
- **Key Role**: Routes HTTP requests to the correct endpoints, serves static files

**Why it's necessary**: Configures how the web server handles requests and serves the drawing board to clients.

---

### Gateway Directory (`/gateway`)

#### `gateway/server.js`
- **Purpose**: WebSocket gateway that bridges browser clients and the RAFT cluster
- **Key Responsibilities**:
  1. **Accept WebSocket connections** from browsers
  2. **Maintain leader discovery** - continuously finds the current RAFT leader
  3. **Route strokes** to the leader for consensus
  4. **Broadcast live drawing** - streams live drawing points to all connected clients
  5. **Handle failover** - detects when leader dies and finds a new one
  6. **Send initial state** - gives new clients all previously committed strokes
- **Key Functions**:
  - `discoverLeader()`: Queries all replicas to find the leader
  - `handleStroke()`: Receives stroke from client, sends to leader, waits for commitment
  - `broadcast()`: Sends messages to all connected clients
  - `sendInitialState()`: Syncs new clients with committed drawing state
- **Maintains**: 
  - `clients` Map: All active WebSocket connections
  - `currentLeader`: The leader node ID and URL
  - `currentTerm`: RAFT term number (used for detecting leadership changes)

**Why it's necessary**: 
- Creates a single connection point for all clients instead of directly connecting to RAFT nodes
- Handles load distribution and leader discovery automatically
- Shields clients from cluster complexity
- Provides real-time synchronization of live strokes

#### `gateway/package.json`
- **Purpose**: NPM package definition and dependency list
- **Contains**: 
  - Project metadata (name, version, description)
  - Scripts: `start` (production) and `dev` (development with nodemon)
  - Dependencies: express (web framework), ws (WebSocket), axios (HTTP client), cors, uuid
- **Key Role**: Specifies all required packages and how to run the service

**Why it's necessary**: Node.js projects need this file to manage dependencies and scripts. Enables reproducible builds.

#### `gateway/Dockerfile`
- **Purpose**: Container image for the gateway service
- **Contains**: 
  - Node.js Alpine base (lightweight)
  - Installs nodemon globally for hot-reload development
  - Copies package.json, installs dependencies
  - Copies source code, exposes port 3000
- **Key Role**: Containerizes the gateway for deployment

**Why it's necessary**: Ensures gateway runs consistently in any environment with all dependencies installed.

#### `gateway/nodemon.json`
- **Purpose**: Configuration for nodemon (development tool for auto-reloading)
- **Contains**: 
  - `watch`: Which files to monitor for changes
  - `ignore`: Which files to ignore
  - `ext`: File extensions to watch
  - `delay`: Delay before restarting after file change
- **Key Role**: Enables hot-reload during development

**Why it's necessary**: Developers can modify code and see changes immediately without manual restart, speeding up development cycle.

---

### Replica Nodes Directory (replica1, replica2, replica3)

#### `replica{1,2,3}/server.js`
- **Purpose**: Implements a Mini-RAFT consensus node
- **Key Responsibilities**:
  1. **RAFT State Machine**: Maintains state as follower, candidate, or leader
  2. **Log Management**: Maintains append-only stroke log
  3. **Election Protocol**: Participates in leader elections
  4. **Log Replication**: Replicates strokes to followers (leader only)
  5. **Heartbeats**: Sends periodic heartbeats to maintain leadership
  6. **Persistence**: Saves state and log to disk
- **Key Functions**:
  - `startElection()`: Initiates leader election
  - `sendHeartbeats()`: Leader sends heartbeats to followers
  - `appendEntries()`: Followers receive log entries from leader
  - `requestVote()`: Handles vote requests during elections
  - `saveState()` / `loadPersistedState()`: Disk persistence
- **Maintains**:
  - `currentTerm`: Monotonically increasing term number
  - `votedFor`: Who we voted for in current term
  - `log`: Append-only stroke log
  - `commitIndex`: Number of committed strokes
  - `role`: Follower, Candidate, or Leader
  - `leaderId`: ID of current leader

**Why it's necessary**: 
- Implements the core RAFT consensus algorithm
- Ensures all replicas agree on the drawing state
- Enables automatic failover when leader dies
- Provides fault tolerance - system survives 1 node failure (2 of 3 quorum)

#### `replica{1,2,3}/package.json`
- **Purpose**: Specifies dependencies for replica nodes
- **Contains**: 
  - express, axios, cors, uuid dependencies
  - Same scripts as gateway (start, dev)

**Why it's necessary**: Each replica needs to declare its dependencies independently.

#### `replica{1,2,3}/Dockerfile`
- **Purpose**: Container image for replica nodes
- **Similar to**: Gateway Dockerfile (Node.js, nodemon, dependencies)

**Why it's necessary**: Enables containerized deployment of each RAFT node.

#### `replica{1,2,3}/nodemon.json`
- **Purpose**: Development auto-reload configuration
- **Same as**: Gateway nodemon.json

**Why it's necessary**: Same as gateway - speeds up development.

#### `replica{1,2,3}/data/raft-log.json`
- **Purpose**: Persistent storage of the append-only stroke log
- **Contains**: Array of log entries: `[{ term, index, stroke }, ...]`
- **Key Role**: Survives node restarts and enables catch-up synchronization
- **Example**:
```json
[
  { "term": 1, "index": 1, "stroke": { "id": "uuid1", "points": [...], "color": "#ff0000" } },
  { "term": 1, "index": 2, "stroke": { "id": "uuid2", "points": [...], "color": "#00ff00" } },
  { "term": 2, "index": 3, "stroke": { "id": "uuid3", "points": [...], "color": "#0000ff" } }
]
```

**Why it's necessary**: 
- Enables data durability - strokes persist even if all nodes crash
- Allows restarted nodes to recover their state
- Ensures new leader sees all committed strokes for proper replication

#### `replica{1,2,3}/data/raft-state.json`
- **Purpose**: Persistent storage of RAFT state
- **Contains**: `{ currentTerm, votedFor, commitIndex }`
- **Key Role**: RAFT requires persisting term and vote info before responding to RPCs
- **Example**:
```json
{
  "currentTerm": 2,
  "votedFor": "replica2",
  "commitIndex": 15
}
```

**Why it's necessary**: 
- RAFT safety depends on never voting twice in the same term
- Persisting term prevents split-brain scenarios
- Enables correct recovery after restarts

---

### Logs Directory (`/logs`)

#### `logs/FAILOVER_LOGS.md`
- **Purpose**: Documentation of actual failover events from testing
- **Contains**: 
  - Logs showing leader election
  - Normal stroke replication
  - Leader failure and automatic re-election
  - Log catch-up after node restart
  - Timing measurements for fault tolerance
- **Key Role**: Demonstrates the system working as designed

**Why it's necessary**: Provides evidence that fault tolerance actually works, useful for understanding system behavior and debugging.

---

## Why Each File is Necessary

### Critical Files (System Cannot Run Without)
| File | Reason |
|------|--------|
| `docker-compose.yml` | Orchestrates all services; without it, services can't communicate |
| `gateway/server.js` | Bridges clients to RAFT cluster; no other entry point for clients |
| `replica{1,2,3}/server.js` | Implements RAFT consensus; no consensus = no fault tolerance |
| `frontend/index.html` | User interface; without it, no way for users to draw |

### Important Infrastructure Files
| File | Reason |
|------|--------|
| `gateway/package.json` | Declares dependencies; NPM won't work without it |
| `replica{1,2,3}/package.json` | Same as gateway - declares all Node.js dependencies |
| Gateway/Replica Dockerfiles | Enable containerization; without them, manual dependency installation needed |
| `frontend/nginx.conf` | Configures web server; wrong config = frontend won't serve files |

### Supporting Files (Nice to Have, But Help Development)
| File | Reason |
|------|--------|
| `gateway/nodemon.json` | Enables hot-reload; without it, manual restarts needed during dev |
| `replica{1,2,3}/nodemon.json` | Same as gateway |
| `README.md` | Documentation; helps users understand project |

### Data Files (Created at Runtime)
| File | Reason |
|------|--------|
| `replica{1,2,3}/data/raft-log.json` | Persistent stroke log; lose this, lose all drawings after crash |
| `replica{1,2,3}/data/raft-state.json` | Persistent RAFT state; lose this, lose consistency guarantees |

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER BROWSERS                           │
│                 (Multiple drawing clients)                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ WebSocket (draw-point, draw-end, stroke)
                         │
                    ┌────▼─────┐
                    │  GATEWAY  │ (Port 3000)
                    │ (server.js)
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    HTTP /append-entries, /request-vote, /log
          │              │              │
    ┌─────▼──┐   ┌──────▼───┐   ┌──────▼───┐
    │Replica1│   │Replica2  │   │Replica3  │
    │(Leader)│───┤(Follower)├───┤(Follower)│
    │Port4001│   │Port 4002 │   │Port 4003 │
    └────┬───┘   └──────────┘   └──────────┘
         │
         │ (Persists to disk)
         │
    ┌────▼──────────────────────┐
    │ Raft State + Log Storage   │
    │ - raft-log.json            │
    │ - raft-state.json          │
    └───────────────────────────┘
```

### Communication Flow

1. **Client Drawing (WebSocket)**:
   - User draws on canvas → Browser sends WebSocket messages to Gateway
   - Message types: `draw-start`, `draw-point`, `draw-end`, `stroke`

2. **Stroke Commitment (HTTP)**:
   - Gateway receives final stroke → Sends to RAFT leader
   - Leader appends to log → Replicates to followers via `/append-entries`
   - Followers acknowledge → Leader commits when majority acks
   - Gateway notifies all clients of committed stroke

3. **Failover (Automatic)**:
   - Leader dies → Followers timeout
   - Election starts → New leader elected
   - Gateway detects → Finds new leader
   - System continues seamlessly

---

## Detailed Technical Architecture

### System Components

#### 1. Frontend (Client Layer)
```
┌──────────────────────────────┐
│   Frontend (index.html)      │
│  ┌────────────────────────┐  │
│  │   HTML5 Canvas         │  │
│  │   Color/Size Picker    │  │
│  │   Status Display       │  │
│  └────────────────────────┘  │
│         ↓                     │
│  ┌────────────────────────┐  │
│  │  WebSocket Client      │  │
│  │  Connect to Gateway    │  │
│  │  Send Strokes          │  │
│  │  Receive Updates       │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Key Features**:
- Real-time canvas rendering
- Live stroke visualization from all clients
- Status indicator (current leader, client count, connection status)
- Auto-reconnection on connection loss

#### 2. Gateway (API Layer)
```
┌──────────────────────────────┐
│     Gateway (server.js)      │
│  ┌────────────────────────┐  │
│  │  WebSocket Server      │  │
│  │  - Accept connections  │  │
│  │  - Route strokes       │  │
│  │  - Broadcast updates   │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  Leader Discovery      │  │
│  │  - Query all replicas  │  │
│  │  - Find current leader │  │
│  │  - Detect failover     │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  State Management      │  │
│  │  - Track leader        │  │
│  │  - Track term          │  │
│  │  - Cache replica health│  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Key Algorithms**:
1. Leader Discovery (every 1 second):
```
For each replica:
  GET /state
  If response.role == 'leader':
    Update currentLeader
    Update currentTerm
    Notify clients
```

2. Stroke Handling:
```
Receive stroke from client
If no leader found:
  Retry discovering leader (up to 5 times)
POST stroke to leader at /append-entry
Wait for commit confirmation
Broadcast to all clients
```

#### 3. RAFT Cluster (Consensus Layer)

Each replica implements Mini-RAFT with 3 roles:

##### Role: Follower
- **Responsibilities**:
  - Listen for heartbeats from leader
  - Respond to vote requests
  - Accept log entries from leader
  - Reset election timeout on heartbeat
- **Transitions**:
  - → Candidate: On election timeout
  - → Follower: On receiving higher term

##### Role: Candidate
- **Responsibilities**:
  - Increment current term
  - Vote for itself
  - Request votes from all peers
  - Wait for majority votes
- **Transitions**:
  - → Leader: Wins election (majority votes)
  - → Follower: Receives higher term or timeout expires

##### Role: Leader
- **Responsibilities**:
  - Send heartbeats periodically (150ms)
  - Accept strokes from gateway
  - Replicate log entries to all followers
  - Advance commit index when majority acks
- **Transitions**:
  - → Follower: Receives higher term

```
State Diagram:
        ┌────────────────────────────────────┐
        │          FOLLOWER                  │
        │  - Listen for heartbeats           │
        │  - Election timeout → CANDIDATE    │
        └────────────────────────────────────┘
                     ▲
                     │
                     │ Higher term or
                     │ Leader dies
                     │
        ┌────────────────────────────────────┐
        │          CANDIDATE                 │
        │  - Vote for self                   │
        │  - Request votes from peers        │
        │  - Timeout → restart election      │
        │  - Win → LEADER                    │
        └────────────────────────────────────┘
                     │
                     │ Majority votes
                     ▼
        ┌────────────────────────────────────┐
        │          LEADER                    │
        │  - Send heartbeats (150ms)         │
        │  - Accept strokes                  │
        │  - Replicate to followers          │
        │  - Advance commitIndex             │
        └────────────────────────────────────┘
```

#### 4. Persistent Storage Layer

Each replica has two files:

**raft-log.json** (Append-Only):
```json
[
  {
    "term": 1,
    "index": 1,
    "stroke": {
      "id": "stroke-uuid-1",
      "clientId": "client-1",
      "points": [
        {"x": 100, "y": 200},
        {"x": 105, "y": 210}
      ],
      "color": "#FF0000",
      "size": 2,
      "timestamp": 1712134175236
    }
  },
  ...
]
```

**raft-state.json** (Mutable):
```json
{
  "currentTerm": 2,
  "votedFor": "replica2",
  "commitIndex": 10
}
```

**Why This Design**:
- Log is append-only: Never delete, only add
- State is mutable: Can change when receiving RPCs
- Both persisted: Survive crashes
- Enables recovery: Restart reads from disk

---

## RAFT Consensus Protocol Implementation

### Key RAFT Properties

#### 1. Leader Election

**Trigger**: Follower doesn't receive heartbeat for `ELECTION_TIMEOUT` (300-450ms)

**Process**:
```
Follower Timeout
  ↓
Become Candidate
  ↓
Increment Term (term + 1)
  ↓
Vote for self
  ↓
Send RequestVote RPCs to all peers in parallel
  ↓
Wait for responses
  ↓
If received votes > N/2 (N=3, need 2):
  Become Leader
  Send heartbeats
Else if received term higher:
  Become Follower with new term
Else if timeout:
  Start new election
```

**Code Example** (from `replica/server.js`):
```javascript
async function startElection() {
  state.currentTerm++;
  state.role = 'candidate';
  state.votedFor = NODE_ID;
  saveState();
  
  const votes = 1; // Vote for self
  const promises = PEERS.map(async (peerUrl) => {
    try {
      const response = await axios.post(`${peerUrl}/request-vote`, {
        term: state.currentTerm,
        candidateId: NODE_ID,
        lastLogIndex: getLastLogIndex(),
        lastLogTerm: getLastLogTerm()
      }, { timeout: 100 });
      
      if (response.data.voteGranted) {
        return 1;
      }
    } catch (error) {
      // Timeout or error
    }
    return 0;
  });
  
  const voteResults = await Promise.all(promises);
  const totalVotes = votes + voteResults.reduce((a, b) => a + b, 0);
  
  if (totalVotes > PEERS.length / 2) {
    becomeLeader(); // Majority achieved
  }
}
```

#### 2. Log Replication

**Trigger**: Leader receives stroke from gateway

**Process**:
```
Leader receives stroke
  ↓
Append to log with current term
  ↓
Send AppendEntries RPC to all followers in parallel
  ├─ prevLogIndex, prevLogTerm (for consistency check)
  ├─ entries (new log entries)
  └─ leaderCommit (for commit index)
  ↓
Wait for follower responses
  ↓
If follower.success == true:
  Update nextIndex[follower] += entries.length
  Update matchIndex[follower] = new index
Else if follower.term > currentTerm:
  Become Follower
Else:
  Decrement nextIndex[follower] (retry logic)
  ↓
If matchIndex >= N/2 (majority has entry):
  Advance commitIndex
  Notify all followers
```

**Code Example**:
```javascript
async function sendHeartbeats() {
  const promises = PEERS.map(async (peerUrl) => {
    const prevLogIndex = state.nextIndex[peerUrl] - 1;
    const prevLogTerm = prevLogIndex > 0 
      ? state.log[prevLogIndex - 1].term 
      : 0;
    
    const entries = state.log.slice(prevLogIndex);
    
    const response = await axios.post(`${peerUrl}/append-entries`, {
      term: state.currentTerm,
      leaderId: NODE_ID,
      prevLogIndex,
      prevLogTerm,
      entries,
      leaderCommit: state.commitIndex
    }, { timeout: 100 });
    
    if (response.data.success) {
      state.matchIndex[peerUrl] = prevLogIndex + entries.length;
    }
  });
  
  await Promise.all(promises);
  
  // Advance commitIndex if majority has the entry
  const sortedMatchIndices = Object.values(state.matchIndex).sort((a, b) => b - a);
  const majority = Math.floor(PEERS.length / 2) + 1;
  const newCommitIndex = sortedMatchIndices[majority - 1];
  
  if (newCommitIndex > state.commitIndex) {
    state.commitIndex = newCommitIndex;
    saveState();
  }
}
```

#### 3. Safety Properties

**Election Safety**: At most one leader per term
- Why: Candidate must win majority votes
- Impossible for 2 candidates to each win majority (quorum overlap)

**Append-Only Property**: Log entries only go forward
- Why: Entries are never deleted or modified
- Old entries can be replaced only by entries with higher term

**State Machine Safety**: All committed entries are applied in same order
- Why: commitIndex only advances when majority has entry
- Only leader can advance commitIndex

**Leader Completeness**: Leader has all committed entries
- Why: Leader must have latest term to win election
- Voters only vote for candidates with log at least as complete

---

## Data Flow & Examples

### Example 1: Normal Operation - User Draws a Stroke

```
TIME    BROWSER                 GATEWAY              REPLICA 1 (LEADER)  REPLICA 2 (FOLLOWER) REPLICA 3 (FOLLOWER)
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
0ms     User draws line
        stroke = {id, points, color, size}
        │
5ms     ws.send({type: 'stroke', stroke})
        │                                  
10ms                            receive stroke
                                validate
                                │
15ms                            POST /append-entry
                                {term: 1, leaderId: gateway,
                                 stroke: ...}
                                │                                                           
20ms                                                  log.push(stroke)
                                                       nextIndex[replica2] = 3
                                                       │
                                                       POST /append-entries
                                                       {term: 1, entries: [new stroke]}
                                                       │                                    │
25ms                                                                          log.push(stroke)  log.push(stroke)
                                                                              response: success response: success
                                                                              │
30ms                                                  ✓ majority acked
                                                       commitIndex = 3
                                                       │
                                                       response: committed
                                │
35ms                            broadcast to all clients
                                {type: 'committed-stroke', stroke}
                                │
40ms    receive committed-stroke
        canvas.render(stroke)
        ✓ Drawing appears on screen

Total latency: ~40ms (dominated by network round-trips)
```

### Example 2: Failover - Leader Dies

```
INITIAL STATE:
  Replica1 = LEADER (term 1)
  Replica2 = FOLLOWER
  Replica3 = FOLLOWER

TIME    REPLICA1         REPLICA2         REPLICA3         GATEWAY
──────────────────────────────────────────────────────────────────
0ms     [sending heartbeats every 150ms]
        
1000ms                   heartbeat received
                         election timer reset
        
1050ms                                    heartbeat received
                                          election timer reset

1100ms  CRASH! ───────────────────────────────────────────────X

1200ms  [no heartbeat]
        [no heartbeat]
        election timeout!
        │
        term = 2
        role = candidate
        votedFor = replica2
        │
1220ms  ─── RequestVote(term: 2) ───►
                                   ✓ vote granted
                         response:
                         voteGranted: true
                                          
1225ms  ─────────────── RequestVote(term: 2) ───►
                                             ✓ vote granted
                                          response:
                                          voteGranted: true
        
1230ms  received 2 votes (total 3, need 2) ✓ MAJORITY!
        role = LEADER
        term = 2
        │
        start sending heartbeats
        
1235ms                   heartbeat from replica2
                         {term: 2, leader}
                         
        ─ Current leader check
          GET /state ─► {role: leader, term: 2} ─── response
        
        New leader discovered!
        broadcast to clients:
        {type: 'leader-change', leader: replica2, term: 2}

Total failover time: ~150ms (one election timeout + RPC latency)
```

### Example 3: Log Catch-up - Node Restarts

```
BEFORE RESTART:
  Replica1 (disk): log has 10 entries, commitIndex: 10
  Replica2 (leader): log has 12 entries, commitIndex: 12
  Replica3: log has 12 entries

REPLICA1 CRASHES → RESTARTS

TIME    REPLICA1                REPLICA2 (LEADER)
──────────────────────────────────────────────────
0ms     Startup
        Read from disk:
        - currentTerm: 1
        - votedFor: null
        - commitIndex: 10
        - log: [10 entries]
        
        role = FOLLOWER
        election timer started
        │

50ms    REQUEST: GET /state
        ────────────────────► send state to gateway
                             leader sees replica1 is back

100ms   heartbeat from leader with entries 11-12
        {entries: [{term:2, stroke}]}
        │
        log.push(entry 11)
        log.push(entry 12)
        │
200ms   [next heartbeat with leaderCommit: 12]
        commitIndex = 12
        
        ✓ Fully caught up!
```

---

## Fault Tolerance & Failover Mechanism

### Failure Scenarios Handled

#### 1. **Single Replica Failure (1 of 3 nodes crash)**
- **What Happens**: 
  - Remaining 2 nodes form majority
  - System continues operating normally
  - Client operations complete successfully
  - Failed node can be restarted anytime

- **Recovery**: Restarted node syncs from leader

#### 2. **Leader Failure (Most Critical)**
- **Detection**: Heartbeat timeout (300-450ms)
- **Election**: Followers start election, one becomes new leader (~150ms)
- **Result**: System continues with new leader
- **Strokes in Flight**: May be lost if not yet replicated (retry mechanism)

#### 3. **Temporary Network Partition**
- **Scenario**: Leader isolated from followers
- **Behavior**: Leader becomes follower after losing majority
- **Result**: New leader elected among remaining nodes

#### 4. **Multiple Node Failures**
- **2+ nodes crash**: System loses quorum, cannot commit new strokes
- **Behavior**: Reads still work, writes blocked
- **Recovery**: When majority comes back online, system resumes

### Quorum Mechanism

With 3 nodes:
- **Quorum size**: 2 (majority)
- **Can tolerate**: 1 failure
- **Cannot tolerate**: 2+ failures

```
Total Nodes    Quorum    Can Tolerate
─────────────────────────────────────
3              2         1 failure
5              3         2 failures
7              4         3 failures
2N+1           N+1       N failures
```

### Automatic Failover Timeline

```
Event                          Time         Details
────────────────────────────────────────────────────────────
Leader dies                    0ms          System: Ready
Followers detect timeout       300-450ms    Random election timeout
Candidates request votes       ~450ms       RPC latency
Followers vote                 ~475ms       Vote responses received
New leader elected             ~500ms       Becomes leader after majority
New leader sends heartbeat     ~550ms       Followers ACK
Gateway discovers new leader   ~1000ms      Periodic discovery polling (1s interval)
System fully operational       ~1000ms      Clients can draw again
────────────────────────────────────────────────────────────
Total time to recover: ~1 second
```

---

## Possible Teacher Questions & Answers

### Q1: Why use RAFT consensus instead of just replicating to all nodes?

**A**: Simple replication has critical flaws:

| Aspect | Simple Replication | RAFT Consensus |
|--------|-------------------|-----------------|
| **Split-brain** | If network splits, can have 2 leaders | Only 1 leader (quorum guarantee) |
| **Consistency** | No guarantee all replicas same | All committed entries identical |
| **Failover** | Manual intervention needed | Automatic leader election |
| **Data safety** | Entries can be lost | Committed entries never lost |

**Example of split-brain problem**:
```
Network Split:
  Primary server → can't reach replicas
  Clients connect to primary
  Clients connect to replica thinking it's leader
  
Result: Two leaders, conflicting writes, data corruption
RAFT prevents this: Minority partition can't commit new entries
```

---

### Q2: What happens if the leader receives a stroke but then crashes before replicating it?

**A**: Depends on when the crash happens:

1. **Crash before replicating** (most common):
   - Stroke is in leader's log
   - Leader dies
   - New leader elected
   - New leader may not have this stroke in its log
   - Stroke is lost (but gracefully handled)
   - Gateway retries from client

2. **Crash after replicating to majority**:
   - Stroke already replicated to 2+ nodes
   - Even if leader dies, new leader will have it
   - Stroke survives

**Code Protection**:
```javascript
// Gateway waits for leader confirmation
try {
  response = await axios.post(
    `${leaderUrl}/append-entry`, 
    {stroke},
    {timeout: 5000}
  );
  
  if (response.committed) {
    // Safe to tell client
    broadcast({stroke});
  }
} catch {
  // Timeout or error - leader maybe crashed
  // Discover new leader and retry
  discoverLeader();
  // Retry append-entry
}
```

---

### Q3: Why is disk persistence necessary if you have replication?

**A**: Replication + Persistence provides complete durability:

| Scenario | Disk | Replication | Result |
|----------|------|-------------|--------|
| Single node crashes | ✓ | ✗ | Lost if all 3 crash |
| Network partition | ✗ | ✓ | Lost if minority partition |
| All nodes crash | ✗ | ✗ | Lost forever |
| All nodes crash then restart | ✓ | ✓ | Recovered from disk |

**Example**:
```
State 1: 3 nodes running, 10 strokes committed to all
  Disk: [10 entries]

State 2: All 3 nodes crash simultaneously
  Memory: All lost
  Disk: [10 entries] ✓ SAFE

State 3: All restart together
  Load from disk: [10 entries]
  Users see all strokes back
```

**Without disk**: All 10 strokes would be lost forever!

---

### Q4: How does the system guarantee the same drawing state across all clients?

**A**: Through 3 layers of guarantee:

1. **Append-Only Log**: 
   - Strokes in exact order in log
   - Same order on all replicas
   - No deletions or modifications

2. **Commit Index**: 
   - Only "committed" strokes shown to clients
   - Committed = replicated to majority
   - Majority guarantee = all future leaders have it

3. **Initial Sync**: 
   - New client gets all committed strokes first
   - Then gets live strokes as they're committed

**Result**: All clients see exact same drawing in exact same order

```
Timeline:
  T1: Stroke1 committed (2/3 replicas)     → All clients see Stroke1
  T2: Stroke2 committed (2/3 replicas)     → All clients see Stroke2
  T3: Stroke3 committed (2/3 replicas)     → All clients see Stroke3
  
If new client joins at T3.5:
  Receives: [Stroke1, Stroke2, Stroke3] ← Same as existing clients!
```

---

### Q5: What if 2 nodes claim to be leader at the same time?

**A**: Impossible in a working RAFT implementation. Here's why:

1. **Election Requirement**: 
   - To become leader, candidate must win votes from **majority**
   - With 3 nodes: majority = 2 nodes
   - Only 1 candidate can get 2 votes (pigeonhole principle)

2. **Vote Safety**:
   - Each node votes for at most 1 candidate per term
   - If Node1 votes for Candidate A in term 2, it won't vote for Candidate B
   - Ensures only 1 leader per term

3. **Term Mechanism**:
   - If two nodes think they're leader, they have different terms
   - Lower term leader discovers higher term
   - Steps down to follower

**Proof by example**:
```
Assume two leaders: L1 (term 2) and L2 (term 2)

For L1 to be elected: need 2 votes
For L2 to be elected: need 2 votes

But there are only 3 voters total, and each votes once per term
→ Impossible for both to have 2 votes

QED: Can't have 2 leaders with same term
```

---

### Q6: Why use WebSocket for the gateway but HTTP for replicas?

**A**: Different communication patterns:

| Protocol | Gateway → Clients | Replica → Replica |
|----------|------------------|------------------|
| **WebSocket** | Bidirectional, persistent | Overkill, request/response |
| **HTTP** | Streaming updates needed | Simple, stateless RPC |
| **Latency** | Live updates (ms matter) | Bulk operations (timing less critical) |
| **State** | Clients stay connected | No persistent connection needed |

**Why WebSocket for clients**:
```
WebSocket advantages:
  ✓ Persistent connection (no reconnect overhead)
  ✓ Server can push updates (no polling needed)
  ✓ Low latency (for live drawing)
  ✓ Bidirectional (clients send and receive)

HTTP disadvantages:
  ✗ Request/response only (server can't push)
  ✗ Overhead of opening new connection per request
  ✗ Polling would waste bandwidth and latency
```

**Why HTTP for replicas**:
```
HTTP advantages:
  ✓ Stateless (replica crashes, doesn't affect next RPC)
  ✓ Built-in retry semantics
  ✓ Simple to implement and debug
  ✓ Standard RPC pattern for consensus

WebSocket disadvantages:
  ✗ Persistent connection fails, must reconnect
  ✗ Adds complexity for replica-to-replica
  ✗ Not needed (RPCs are request/response anyway)
```

---

### Q7: How does the system handle client crashes or network disconnects?

**A**: Graceful recovery on reconnect:

```javascript
// Client reconnects after network loss

State Before Disconnect:
  - Last seen strokes: 5
  - Committed strokes on server: 10

On Reconnect:
  1. Browser reconnects WebSocket to Gateway
  2. Gateway sends init message:
     {
       type: 'init',
       strokes: [all 10 committed strokes],
       leader: current_leader,
       term: current_term
     }
  3. Browser clears canvas, draws all 10 strokes
  4. Browser receives live updates for any new strokes
  
Result: Client synchronized, no data loss
```

**What if stroke was in progress when client crashed?**
- Half-drawn stroke is lost (client-side only, not replicated)
- Not a problem (user can redraw)
- RAFT ensures only committed strokes matter

---

### Q8: Can you explain the election timeout randomization?

**A**: Prevents election deadlock:

**Without randomization** (all nodes timeout at same time):
```
Time: 300ms
  All 3 nodes timeout → All become candidates
  All request votes from each other
  Each gets 1 vote (for itself)
  No one gets majority (need 2)
  → Election fails, retry
  
Time: 600ms
  All timeout again → Same problem!
  → Potential livelock
```

**With randomization** (300-450ms):
```
Time: 350ms
  Node1 timeout (got 350ms random)
  → Becomes candidate
  → Requests votes from Node2, Node3
  
Time: 360ms
  Node2 receives vote request
  → Votes for Node1
  
Time: 380ms
  Node3 receives vote request
  → Votes for Node1
  
Time: 385ms
  Node1 has 3/3 votes (including self)
  → Becomes leader ✓
  
Node2, Node3 see heartbeat from Node1
→ Reset election timers (now randomized again)
```

**Math**:
- Range: 300-450ms (150ms spread)
- Guarantees one node will timeout first
- First node likely to win election before others timeout

---

### Q9: What is commitIndex and why track it separately from the log?

**A**: commitIndex represents "consensus point":

```
Replica Log State:

log:        [stroke1, stroke2, stroke3, stroke4]  (in node's log)
             ↑                          ↑
             |                          |
        commitIndex=2              uncommitted
        (guaranteed on 2/3 nodes)

Safe to show clients: stroke1, stroke2 ✓
Unsafe to show: stroke3, stroke4 ✗ (might be lost if leader crashes)
```

**Why separate tracking?**
1. **Safety**: Don't show strokes that might disappear
2. **Progress**: Track which strokes are safe
3. **Durability**: Committed entries survive leader failure

**Code in replica**:
```javascript
// Followers get commitIndex from leader
app.post('/append-entries', (req, res) => {
  const leaderCommitIndex = req.body.leaderCommit;
  
  // Apply leader's commit index
  if (leaderCommitIndex > state.commitIndex) {
    state.commitIndex = Math.min(
      leaderCommitIndex, 
      state.log.length
    );
    // Now safe to apply these strokes to state machine
    applyToStateMachine();
  }
});

// Gateway only uses committed strokes
function sendToClients(strokes) {
  const committedStrokes = strokes
    .slice(0, commitIndex);  // Only up to commitIndex!
  
  broadcast(committedStrokes);
}
```

---

### Q10: How does the system maintain consistency if a leader has stale log entries?

**A**: RAFT has safeguards to ensure leader always has complete log:

1. **Candidate Requirement** (to become leader):
   - Candidate's log must be "at least as complete" as voters
   - Voters compare: (lastLogTerm, lastLogIndex)
   - Won't vote for candidate with older log

2. **Code Check**:
```javascript
// When receiving vote request, voters check candidate's log
function requestVote(req, res) {
  const candidateTerm = req.body.candidateTerm;
  const candidateLastLogIndex = req.body.lastLogIndex;
  const candidateLastLogTerm = req.body.lastLogTerm;
  
  const myLastLogTerm = getLastLogTerm();
  const myLastLogIndex = getLastLogIndex();
  
  // Compare log completeness
  if (candidateLastLogTerm < myLastLogTerm) {
    res.json({voteGranted: false}); // Refuse stale candidate
  } else if (
    candidateLastLogTerm === myLastLogTerm &&
    candidateLastLogIndex < myLastLogIndex
  ) {
    res.json({voteGranted: false}); // Refuse shorter log
  }
  
  // Candidate log is at least as complete
  res.json({voteGranted: true});
}
```

3. **Result**:
   - Only leaders with complete logs can win election
   - Stale logs are never committed to
   - Consistency guaranteed

---

### Q11: What's the maximum cluster you can build with this RAFT implementation?

**A**: Theoretically unlimited, but practically:

| Size | Pros | Cons |
|------|------|------|
| 3 nodes | Sweet spot | Can tolerate 1 failure |
| 5 nodes | Tolerate 2 failures | More complex |
| 7 nodes | Tolerate 3 failures | More network traffic |
| 2N+1 | Tolerate N failures | Quorum search is O(N) |

**Scaling Issues**:
1. **Quorum grows**: Replication slower (wait for majority)
2. **Network traffic**: Every stroke sent to all nodes
3. **Election complexity**: Vote from all nodes
4. **Failure detection**: Takes longer to timeout large cluster

**For this project**: 3 nodes is optimal

---

### Q12: Can this system be used for production drawing applications?

**A**: Depends on requirements:

| Use Case | Suitable? | Why |
|----------|-----------|-----|
| Internal team drawing | ✓ Yes | Small N, low latency requirement |
| Real-time collab editing | ⚠ Maybe | Latency ~40ms acceptable |
| Web whiteboard app | ✓ Yes | Matches typical UX |
| CAD software | ✗ No | Latency too high for precision |
| Banking system | ⚠ Maybe | More consistency guarantees needed |

**Production improvements needed**:
1. **Compression**: Don't send every draw point
2. **Batching**: Batch multiple strokes
3. **Authentication**: Who can draw?
4. **Persistence**: Store to database, not just memory
5. **Monitoring**: Alerting on leader failures
6. **Metrics**: Track latencies, throughput

**Current limitations**:
- Log stored in memory (crashes lose uncommitted strokes)
- No authentication/authorization
- No backup beyond 3-node cluster
- No data deletion (append-only log grows forever)

---

### Q13: Why randomize election timeout between 300-450ms?

**A**: Already covered in Q8, but more details on timing:

**Timing analysis**:
```
HEARTBEAT_INTERVAL = 150ms (Leader sends heartbeat every 150ms)
ELECTION_TIMEOUT = 300-450ms

Why 300ms minimum?
  - Ensures 2+ heartbeats before timeout
  - Gives leader time to contact all replicas
  - Prevents spurious elections
  
Why 450ms maximum?
  - Too high = slow failover (bad for availability)
  - Too low = frequent spurious elections (bad for stability)
  - 3x heartbeat interval is reasonable

Why randomize?
  - Without: All nodes timeout simultaneously → deadlock
  - With: One node timeouts first → becomes leader first
  - Spreads timeouts across 150ms window
```

**Historical note**: The original RAFT paper used 150-300ms, this project doubled it for more stability.

---

### Q14: What happens to the drawing if the same stroke is processed twice?

**A**: Each stroke has unique UUID, preventing duplicates:

```javascript
// Stroke structure
{
  id: "uuid-unique-per-stroke",  // ← KEY!
  clientId: "client-uuid",
  points: [...],
  color: "#FF0000",
  size: 2,
  timestamp: 1712134175236
}

// On gateway retry:
function handleStroke(stroke) {
  if (!stroke.id) {
    stroke.id = uuidv4();  // First time gets unique ID
  }
  // If client resends same stroke:
  // → Same UUID
  // → Idempotent operation (adding twice is same as once)
}

// Clients store by ID, not position
strokes = new Map();
strokes.set(stroke.id, stroke);  // Duplicate ID = no double add

// Canvas render
for (const stroke of strokes.values()) {
  canvas.drawStroke(stroke);  // Each drawn exactly once
}
```

**Result**: Even if network duplicates stroke 5 times, drawn only once

---

### Q15: How does the gateway know which replica is the leader?

**A**: Active discovery with caching:

```javascript
// Every 1 second
setInterval(async () => {
  // Option 1: Leader is already known
  if (currentLeaderUrl) {
    try {
      const state = await axios.get(`${currentLeaderUrl}/state`);
      if (state.role === 'leader') {
        // Still leader, update term
        currentTerm = state.term;
        return; // No change needed
      }
    } catch (e) {
      // Leader unreachable, discovery needed
    }
  }
  
  // Option 2: Leader unknown or unreachable, discover
  for (const replicaUrl of REPLICA_URLS) {
    try {
      const state = await axios.get(`${replicaUrl}/state`);
      
      if (state.role === 'leader') {
        // Found leader
        currentLeader = state.nodeId;
        currentLeaderUrl = replicaUrl;
        currentTerm = state.term;
        broadcast({type: 'leader-change'});
        return;
      } else if (state.leaderId) {
        // Follower knows who leader is
        const leaderUrl = findUrlByNodeId(state.leaderId);
        if (leaderUrl) {
          currentLeader = state.leaderId;
          currentLeaderUrl = leaderUrl;
          currentTerm = state.term;
          return;
        }
      }
    } catch (e) {
      // Replica not responding
    }
  }
}, 1000);
```

**Smart optimizations**:
1. Cache current leader (avoid querying every request)
2. Use follower redirects (they know leader)
3. Retry all replicas if needed
4. Periodic re-check (even if leader seems fine)

---

### Q16: Could this work over the internet with high latency?

**A**: Mostly yes, with tuning:

| Factor | Impact | Current | Internet |
|--------|--------|---------|----------|
| **Latency** | Slows RPC | <10ms | 100-500ms |
| **Heartbeat** | 150ms interval | Good | May be too frequent |
| **Election timeout** | 300-450ms | Good | Should increase |
| **Throughput** | Strokes/sec | 100s | Limited by bandwidth |

**Required changes**:
```javascript
// For high-latency networks:
const HEARTBEAT_INTERVAL = 500;      // Reduce frequency (500ms)
const ELECTION_TIMEOUT_MIN = 2000;   // Increase (2 seconds)
const ELECTION_TIMEOUT_MAX = 3000;   // Increase (3 seconds)
const RPC_TIMEOUT = 1000;            // Longer timeout for RPCs

// Why?
// - Less overhead if network is slow
// - Fewer spurious timeouts
// - Still provides fault tolerance
```

**Would still work**, but:
- Slower failover (~3 seconds instead of 1 second)
- More strokes to retry on network issues
- Still consistent (RAFT doesn't require low latency)

---

### Q17: Why is the log append-only? Can't you delete old entries?

**A**: Append-only is a RAFT requirement for safety:

**If deletion allowed**:
```javascript
// Dangerous scenario:

Term 1: Leader appends stroke1, replicates to 2/3 nodes
        commitIndex = 1
        Strokes: [stroke1] ✓

Later, delete stroke1 (why would you?):
        Strokes: [] ✗ Inconsistent!
        
New leader election might not have seen stroke1 deleted
→ Split brain: Some replicas have stroke1, some don't
→ Clients see different drawings!
```

**RAFT guarantees**:
- Entries never deleted (after log format)
- Can only add new entries
- Ensures monotonic progress
- Prevents re-writes

**For this project**:
```
Practical implications:
- Log grows forever
- Need cleanup eventually (delete very old strokes)
- For real system: implement "log compaction" or "snapshotting"
- Demo system: no cleanup (fine for limited time)
```

**Log compaction technique**:
```javascript
// Don't delete from log, create snapshot instead:

// Old: [stroke1, stroke2, stroke3, stroke4]
// Snapshot at index 2: captures all state up to stroke2

// New: [snapshot_of_2, stroke3, stroke4]
// When recovering: apply snapshot + remaining strokes
```

---

### Q18: What if the leader receives strokes but network fails before replicating?

**A**: Gateway handles retry:

```javascript
// Gateway receiving stroke:
async function handleStroke(stroke, clientId) {
  if (!currentLeaderUrl) {
    await discoverLeader();
  }
  
  let attempts = 0;
  const MAX_ATTEMPTS = 5;
  
  while (attempts < MAX_ATTEMPTS) {
    try {
      const response = await axios.post(
        `${currentLeaderUrl}/append-entry`,
        { stroke },
        { timeout: 5000 }
      );
      
      if (response.data.committed) {
        // Success! Broadcast to clients
        broadcast({type: 'committed-stroke', stroke});
        return;
      }
    } catch (error) {
      attempts++;
      
      if (attempts === MAX_ATTEMPTS) {
        // Give up, tell client
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to commit stroke'
        }));
        return;
      }
      
      // Retry with delay
      await sleep(100);
      
      // Leader might have changed
      if (error.response?.status === 503) {
        await discoverLeader();
      }
    }
  }
}
```

**Scenario**: Leader crashes after receiving but before replication
- Stroke not replicated to majority
- New leader doesn't have stroke
- Gateway timeout → retry → discovers new leader → stroke committed by new leader
- Or retry exceeds max attempts → tell client "failed, try again"

---

### Q19: How does the frontend know when to refresh the canvas?

**A**: WebSocket messages trigger re-renders:

```javascript
// Browser-side (index.html):

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'init':
      // Initial connection: receive all existing strokes
      data.strokes.forEach(stroke => {
        allStrokes.push(stroke);
      });
      redrawCanvas();
      break;
      
    case 'committed-stroke':
      // New stroke committed by consensus
      allStrokes.push(data.stroke);
      redrawCanvas();
      break;
      
    case 'draw-point':
      // Live drawing from another client (real-time)
      drawPointLive(data.point, data.color, data.size);
      // (canvas updated immediately, not waiting for commitment)
      break;
      
    case 'draw-start', 'draw-end':
      // Manage stroke rendering state
      break;
      
    case 'leader-change':
      // Update status display
      updateStatusDisplay(data.leader, data.term);
      break;
  }
};

function redrawCanvas() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  allStrokes.forEach(stroke => {
    // Draw all strokes from the beginning
    ctx.beginPath();
    stroke.points.forEach((point, idx) => {
      if (idx === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.stroke();
  });
}
```

**Two render paths**:
1. **Live drawing** (draw-point): Instant, no consensus
2. **Committed strokes** (committed-stroke): After consensus

**User experience**:
- Draw locally → See immediately (live)
- Other user draws → See committed version (safe, persistent)

---

### Q20: How would you extend this to support undo/redo?

**A**: Possible but complex, here's why:

**Naive approach (BROKEN)**:
```javascript
// ✗ Wrong: Just remove from log
allStrokes.pop();  // Undo last stroke
redrawCanvas();

// Problem: Other clients don't see undo!
// Only local UI updated, RAFT log still has stroke
// Inconsistency!
```

**Correct approach**:
```javascript
// ✓ Right: Append "undo" action to log

// Instead of modifying log, add special entries:
{
  type: "stroke",
  stroke: {id: "uuid-1", ...}
}

// Then later:
{
  type: "undo",
  undoStrokeId: "uuid-1"
}

// All replicas see both entries
// Undo is consensus-driven
// All clients see same undo state

// Rendering:
function render() {
  let strokes = [];
  let undone = new Set();
  
  for (const entry of log) {
    if (entry.type === 'stroke') {
      strokes.push(entry.stroke);
    } else if (entry.type === 'undo') {
      undone.add(entry.undoStrokeId);
    }
  }
  
  // Draw only non-undone strokes
  strokes
    .filter(s => !undone.has(s.id))
    .forEach(s => drawStroke(s));
}
```

**Requirements for production**:
1. Each stroke needs unique UUID (already have!)
2. Add undo entries to log (new feature)
3. Clients must understand undo entries
4. Gateway routes undo requests to leader
5. Handle undo conflicts (A undoes while B draws)

**Why not just delete from log?** Already covered in Q17 - append-only is safety requirement!

---

## Conclusion

Your Distributed Drawing Board is a sophisticated system that demonstrates:

✅ **Distributed Systems**: Multiple nodes working together  
✅ **Consensus Algorithms**: RAFT for fault tolerance  
✅ **Real-time Systems**: WebSocket-based live updates  
✅ **Fault Tolerance**: Survives 1 of 3 node failures  
✅ **Data Persistence**: Survives crashes via disk storage  
✅ **Network Challenges**: Handles leader failures automatically  

**Key Takeaway**: Despite its simple appearance (drawing app), this project implements enterprise-grade distributed systems concepts used in databases, cache systems, and production systems worldwide.

---

**Last Updated**: April 15, 2026  
**Project Status**: Educational demonstration of RAFT consensus protocol
