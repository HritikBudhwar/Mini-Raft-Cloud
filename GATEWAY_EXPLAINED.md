# 🔌 Gateway Server Explained - Line by Line

The gateway is the **middleman between browsers and the RAFT cluster**. It's like a traffic controller directing all drawing strokes to the leader, then broadcasting the results back to all clients.

---

## 📋 Table of Contents

1. [Setup & Configuration](#setup--configuration)
2. [Core State Variables](#core-state-variables)
3. [Leader Discovery](#leader-discovery)
4. [WebSocket Handling](#websocket-handling)
5. [Message Types](#message-types)
6. [HTTP Endpoints](#http-endpoints)
7. [Broadcasting](#broadcasting)
8. [Complete Flow Examples](#complete-flow-examples)

---

## Setup & Configuration

### Lines 1-26: Imports & Server Setup

```javascript
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
```

**What this does:**
- `express` - HTTP server framework
- `ws` - WebSocket library for real-time browser connections
- `http` - Create HTTP server (needed for WebSockets)
- `axios` - Make HTTP requests to replicas
- `cors` - Allow cross-origin requests
- `uuid` - Generate unique IDs for clients and strokes

**Why we need both Express and WebSocket?**
- WebSocket for **real-time drawing updates** to browsers (fast)
- Express for **REST APIs** that replicas call (e.g., `/commit-stroke`)

---

### Lines 28-34: Configuration

```javascript
const PORT = process.env.PORT || 3000;
const REPLICA_URLS = (process.env.REPLICA_URLS || 'http://replica1:4001,http://replica2:4002,http://replica3:4003')
  .split(',')
  .filter(u => u);
```

**What this does:**
- `PORT`: Gateway listens on port 3000 (can override with env variable)
- `REPLICA_URLS`: List of all 3 replica servers
  - Default: `replica1:4001`, `replica2:4002`, `replica3:4003`
  - The gateway will query these to find the leader

---

## Core State Variables

### Lines 36-41: Global State

```javascript
let currentLeader = null;
let currentLeaderUrl = null;
let currentTerm = 0;
const clients = new Map();              // clientId -> ws
let replicaCache = new Map();           // url -> { role, term, nodeId, healthy, lastUpdated }
```

**What each stores:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `currentLeader` | Node ID of current leader | `"replica1"` |
| `currentLeaderUrl` | HTTP URL of leader | `"http://replica1:4001"` |
| `currentTerm` | Current election round | `10` |
| `clients` | All connected browsers | `Map { "abc123" → ws1, "def456" → ws2 }` |
| `replicaCache` | Last known state of each replica | `{ "http://replica1:4001": { role: "leader", term: 10, healthy: true } }` |

**Why this matters:**
- Gateway needs to know **who the leader is** to route strokes
- Gateway tracks **all clients** so it can broadcast updates
- Cache stores replica info to avoid querying them too often

---

## Leader Discovery

### Lines 48-52: Logging Function

```javascript
function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [GATEWAY] ${message}`, 
    Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}
```

**What it does:**
- Prints timestamped log messages with context
- Every log shows: `[2026-04-17T02:07:23.469Z] [GATEWAY] Message {"data":"value"}`

---

### Lines 55-100: Finding the Leader

```javascript
async function discoverLeader() {
  log('Discovering leader...');
  
  for (const replicaUrl of REPLICA_URLS) {
    try {
      const response = await axios.get(`${replicaUrl}/state`, { timeout: 500 });
      
      // Update cache
      replicaCache.set(replicaUrl, {
        ...response.data,
        healthy: true,
        lastUpdated: Date.now()
      });
      
      if (response.data.role === 'leader') {
        const oldLeader = currentLeader;
        const oldTerm = currentTerm;
        
        currentLeader = response.data.nodeId;
        currentLeaderUrl = replicaUrl;
        currentTerm = response.data.term;
        log(`Found leader: ${currentLeader}`, { url: currentLeaderUrl, term: currentTerm });
        
        if (oldLeader !== currentLeader || oldTerm !== currentTerm) {
          broadcast({
            type: 'leader-change',
            leader: currentLeader,
            term: currentTerm
          });
        }
        return true;
      }
      
      if (response.data.leaderId) {
        const leaderUrl = REPLICA_URLS.find(u => u.includes(response.data.leaderId));
        if (leaderUrl) {
          const oldLeader = currentLeader;
          const oldTerm = currentTerm;
          
          currentLeader = response.data.leaderId;
          currentLeaderUrl = leaderUrl;
          currentTerm = response.data.term;
          log(`Found leader from ${response.data.nodeId}: ${currentLeader}`);
          
          if (oldLeader !== currentLeader || oldTerm !== currentTerm) {
            broadcast({
              type: 'leader-change',
              leader: currentLeader,
              term: currentTerm
            });
          }
          return true;
        }
      }
    } catch (error) {
      // Replica unavailable - mark as unhealthy in cache
      replicaCache.set(replicaUrl, {
        healthy: false,
        error: error.message,
        lastUpdated: Date.now()
      });
    }
  }
  
  log('No leader found, cluster may be electing');
  return false;
}
```

**What this does - Step by step:**

1. **Loop through all replicas** and ask each "Are you the leader?"
   ```javascript
   for (const replicaUrl of REPLICA_URLS) {
     const response = await axios.get(`${replicaUrl}/state`, { timeout: 500 });
   }
   ```

2. **Update the cache** with replica's current state
   ```javascript
   replicaCache.set(replicaUrl, {
     ...response.data,           // Merge all data from replica
     healthy: true,
     lastUpdated: Date.now()
   });
   ```

3. **Check if this replica is the leader**
   ```javascript
   if (response.data.role === 'leader') {
     currentLeader = response.data.nodeId;
     currentLeaderUrl = replicaUrl;
   }
   ```

4. **If not leader, but it knows who the leader is**, use that info
   ```javascript
   if (response.data.leaderId) {
     // Replica said "I know the leader is replica1"
     currentLeader = response.data.leaderId;
   }
   ```

5. **If leader changed, tell all clients**
   ```javascript
   if (oldLeader !== currentLeader) {
     broadcast({
       type: 'leader-change',
       leader: currentLeader,
       term: currentTerm
     });
   }
   ```

6. **If replica is down, mark it as unhealthy**
   ```javascript
   catch (error) {
     replicaCache.set(replicaUrl, {
       healthy: false,
       error: error.message
     });
   }
   ```

---

### Lines 103-128: Continuous Leader Monitoring

```javascript
setInterval(async () => {
  if (currentLeaderUrl) {
    try {
      const response = await axios.get(`${currentLeaderUrl}/state`, { timeout: 500 });
      if (response.data.role !== 'leader') {
        log('Current leader is no longer leader, discovering new leader');
        currentLeader = null;
        currentLeaderUrl = null;
        await discoverLeader();
      } else {
        if (response.data.term !== currentTerm) {
          currentTerm = response.data.term;
          broadcast({
            type: 'leader-change',
            leader: currentLeader,
            term: currentTerm
          });
        }
      }
    } catch (error) {
      log('Lost connection to leader, discovering new leader');
      currentLeader = null;
      currentLeaderUrl = null;
      await discoverLeader();
    }
  } else {
    await discoverLeader();
  }
}, 1000);
```

**What this does:**
- Every 1000ms (1 second), check if the current leader is still the leader
- If leader died (connection error), find a new one
- If leader changed term (election happened), tell clients
- If we don't have a leader yet, search for one

**Timeline example:**
```
T=0s:  replica1 is leader
       Gateway knows: currentLeader = "replica1"

T=5s:  User stops replica1
       Leader no longer sending heartbeats

T=5s:  Gateway still thinks replica1 is leader
       (checks every 1 second, but just checked)

T=6s:  Gateway asks replica1 "Are you still leader?"
       Connection timeout! ❌
       currentLeader = null
       Starts searching for new leader

T=6s:  replica2 and replica3 start election
       One becomes leader

T=6s:  Gateway discovers new leader (replica2)
       Broadcasts to all clients: "New leader: replica2"

T=7s:  Next check - verifies replica2 is still leader ✓
```

---

## WebSocket Handling

### Lines 131-136: Client Connection

```javascript
wss.on('connection', async (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  
  log(`Client connected: ${clientId}`, { totalClients: clients.size });
  
  await sendInitialState(ws, clientId);
```

**What this does:**
1. Browser connects via WebSocket
2. Assign unique ID to this browser: `"a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6"`
3. Store the WebSocket connection: `clients.set("a1b2c3d4...", ws)`
4. Log the connection
5. Send all previously drawn strokes to new client

---

### Lines 138-170: Message Handling

```javascript
ws.on('message', async (message) => {
  try {
    const data = JSON.parse(message);
    
    if (data.type === 'stroke') {
      await handleStroke(data.stroke, clientId);
    } else if (data.type === 'draw-point') {
      broadcastToOthers(clientId, {
        type: 'draw-point',
        clientId: clientId,
        point: data.point,
        color: data.color,
        size: data.size,
        strokeId: data.strokeId
      });
    } else if (data.type === 'draw-start') {
      broadcastToOthers(clientId, {
        type: 'draw-start',
        clientId: clientId,
        point: data.point,
        color: data.color,
        size: data.size,
        strokeId: data.strokeId
      });
    } else if (data.type === 'draw-end') {
      broadcastToOthers(clientId, {
        type: 'draw-end',
        clientId: clientId,
        strokeId: data.strokeId
      });
    } else if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  } catch (error) {
    log(`Error processing message from ${clientId}: ${error.message}`);
  }
});
```

**Message types the gateway receives:**

| Type | Purpose | Example |
|------|---------|---------|
| `stroke` | Finalized stroke (ready to save) | `{ type: 'stroke', stroke: {...} }` |
| `draw-point` | Live drawing point | `{ type: 'draw-point', point: {x, y}, color: '#FF0000' }` |
| `draw-start` | Start drawing | `{ type: 'draw-start', point: {x, y} }` |
| `draw-end` | Stop drawing | `{ type: 'draw-end', strokeId: 'abc123' }` |
| `ping` | Keep-alive check | `{ type: 'ping' }` |

**What each does:**

1. **`stroke` messages** → Send to leader for consensus
   ```javascript
   if (data.type === 'stroke') {
     await handleStroke(data.stroke, clientId);
   }
   ```

2. **`draw-point` messages** → Broadcast to OTHER clients (not sender)
   ```javascript
   else if (data.type === 'draw-point') {
     broadcastToOthers(clientId, {
       type: 'draw-point',
       clientId: clientId,
       point: data.point,
       ...
     });
   }
   ```
   This shows live drawing as the user draws (before it's committed)

3. **`ping` messages** → Respond with `pong` (health check)
   ```javascript
   else if (data.type === 'ping') {
     ws.send(JSON.stringify({ type: 'pong' }));
   }
   ```

---

### Lines 172-183: Client Disconnect

```javascript
ws.on('close', () => {
  clients.delete(clientId);
  log(`Client disconnected: ${clientId}`, { totalClients: clients.size });
});

ws.on('error', (error) => {
  log(`WebSocket error for ${clientId}: ${error.message}`);
  clients.delete(clientId);
});
```

**What this does:**
- When browser closes connection, remove from `clients` map
- If WebSocket error occurs, also remove from map
- Log how many clients are still connected

---

### Lines 185-210: Send Initial State to New Client

```javascript
async function sendInitialState(ws, clientId) {
  for (const replicaUrl of REPLICA_URLS) {
    try {
      const logResponse = await axios.get(`${replicaUrl}/log`, { timeout: 2000 });
      const committedStrokes = logResponse.data.log
        .slice(0, logResponse.data.commitIndex)
        .map(entry => entry.stroke);
      
      ws.send(JSON.stringify({
        type: 'init',
        strokes: committedStrokes,
        leader: currentLeader,
        term: currentTerm
      }));
      
      log(`Sent ${committedStrokes.length} existing strokes to client ${clientId}`);
      return;
    } catch (error) {
      continue;
    }
  }
  
  log(`Failed to get log for new client ${clientId} from any replica`);
  ws.send(JSON.stringify({
    type: 'init',
    strokes: [],
    leader: currentLeader,
    term: currentTerm,
    message: 'Could not fetch existing strokes, but you can still draw!'
  }));
}
```

**What this does:**

1. **Try to get the log from any available replica**
   ```javascript
   for (const replicaUrl of REPLICA_URLS) {
     const logResponse = await axios.get(`${replicaUrl}/log`);
   }
   ```

2. **Get only COMMITTED strokes** (not pending ones)
   ```javascript
   const committedStrokes = logResponse.data.log
     .slice(0, logResponse.data.commitIndex)  // Only up to commitIndex
     .map(entry => entry.stroke);
   ```

3. **Send to client: "Here's what's already drawn"**
   ```javascript
   ws.send(JSON.stringify({
     type: 'init',
     strokes: committedStrokes,    // All 8 existing strokes
     leader: currentLeader,
     term: currentTerm
   }));
   ```

4. **If all replicas are down, send empty list**
   ```javascript
   ws.send(JSON.stringify({
     type: 'init',
     strokes: [],
     message: 'Could not fetch existing strokes, but you can still draw!'
   }));
   ```

**Example:**
```
Replica1 log has:
  [
    { term: 1, stroke: { id: "1", x: 10, y: 20 } },
    { term: 2, stroke: { id: "2", x: 30, y: 40 } },
    { term: 3, stroke: { id: "3", x: 50, y: 60 } }     ← commitIndex: 2
  ]

sendInitialState() will:
  1. Get log from replica1
  2. Take only first 2 entries (because commitIndex = 2)
  3. Extract just the strokes:
     [
       { id: "1", x: 10, y: 20 },
       { id: "2", x: 30, y: 40 }
     ]
  4. Send to new client: "Here's what everyone sees"
  5. Client draws these 2 strokes on canvas
```

---

### Lines 212-258: Handle Stroke (Send to Leader)

```javascript
async function handleStroke(stroke, clientId) {
  if (!stroke.id) {
    stroke.id = uuidv4();
  }
  stroke.clientId = clientId;
  stroke.timestamp = Date.now();
  
  log(`Received stroke from ${clientId}`, { strokeId: stroke.id });
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    if (!currentLeaderUrl) {
      await discoverLeader();
      if (!currentLeaderUrl) {
        log('No leader available, retrying...');
        await new Promise(r => setTimeout(r, 200));
        attempts++;
        continue;
      }
    }
    
    try {
      const response = await axios.post(`${currentLeaderUrl}/stroke`, {
        stroke
      }, { timeout: 1000 });
      
      if (response.data.success) {
        log(`Stroke ${stroke.id} accepted by leader`);
        return;
      }
    } catch (error) {
      if (error.response && error.response.status === 503) {
        const newLeaderUrl = error.response.data.leaderUrl;
        if (newLeaderUrl) {
          currentLeaderUrl = newLeaderUrl;
          currentLeader = error.response.data.leaderId;
          log(`Redirected to new leader: ${currentLeader}`);
        } else {
          currentLeaderUrl = null;
          await discoverLeader();
        }
      } else {
        log(`Error forwarding stroke: ${error.message}`);
        currentLeaderUrl = null;
        await discoverLeader();
      }
    }
    
    attempts++;
  }
  
  log(`Failed to forward stroke after ${maxAttempts} attempts`);
}
```

**What this does - The stroke journey:**

1. **Prepare the stroke**
   ```javascript
   if (!stroke.id) {
     stroke.id = uuidv4();  // Give it unique ID if needed
   }
   stroke.clientId = clientId;      // Remember who drew it
   stroke.timestamp = Date.now();   // Record when
   ```

2. **Retry up to 3 times** (to handle failovers)
   ```javascript
   let attempts = 0;
   const maxAttempts = 3;
   while (attempts < maxAttempts) { ... }
   ```

3. **Make sure we know who the leader is**
   ```javascript
   if (!currentLeaderUrl) {
     await discoverLeader();
   }
   ```

4. **Send stroke to leader**
   ```javascript
   const response = await axios.post(`${currentLeaderUrl}/stroke`, {
     stroke
   }, { timeout: 1000 });
   ```

5. **Handle success**
   ```javascript
   if (response.data.success) {
     log(`Stroke ${stroke.id} accepted by leader`);
     return;  // Done!
   }
   ```

6. **Handle "Not leader" error (503)**
   ```javascript
   if (error.response && error.response.status === 503) {
     // Leader told us "I'm not the leader, try this URL"
     const newLeaderUrl = error.response.data.leaderUrl;
     if (newLeaderUrl) {
       currentLeaderUrl = newLeaderUrl;
     } else {
       // Search for new leader
       await discoverLeader();
     }
   }
   ```

7. **Handle other errors (connection timeout, etc)**
   ```javascript
   else {
     log(`Error forwarding stroke: ${error.message}`);
     currentLeaderUrl = null;
     await discoverLeader();  // Try to find a new leader
   }
   ```

**Retry flow example:**
```
Browser sends stroke

Attempt 1:
  → currentLeaderUrl is "http://replica1:4001"
  → POST to replica1: /stroke
  → Connection error! replica1 crashed ❌
  → Clear currentLeaderUrl
  → attempts = 1, continue

Attempt 2:
  → currentLeaderUrl is null
  → Call discoverLeader()
  → Found replica2 is new leader!
  → currentLeaderUrl = "http://replica2:4002"
  → POST to replica2: /stroke
  → Success! ✓
  → return

Result: User's stroke was delivered despite leader crash!
```

---

## HTTP Endpoints

### Lines 263-278: Leader Update (from replica)

```javascript
app.post('/leader-update', (req, res) => {
  const { leaderId, leaderUrl, term } = req.body;
  
  if (term >= currentTerm) {
    currentLeader = leaderId;
    currentLeaderUrl = leaderUrl;
    currentTerm = term;
    log(`Leader update received`, { leaderId, leaderUrl, term });
    
    broadcast({
      type: 'leader-change',
      leader: leaderId,
      term
    });
  }
  
  res.json({ success: true });
});
```

**What this does:**
- When a replica becomes leader, it calls the gateway
- **Purpose:** Tell gateway immediately, don't wait for polling

**Usage:**
```
Replica becomes leader
  ↓
Replica: "Gateway, I'm the new leader!"
POST http://gateway:3000/leader-update
{
  "leaderId": "replica2",
  "leaderUrl": "http://replica2:4002",
  "term": 11
}
  ↓
Gateway updates: currentLeader = "replica2"
  ↓
Gateway tells all browsers: "New leader: replica2"
```

---

### Lines 280-290: Commit Stroke (from replica)

```javascript
app.post('/commit-stroke', (req, res) => {
  const { stroke, index, term } = req.body;
  
  log(`Broadcasting committed stroke`, { strokeId: stroke.id, index, term });
  
  broadcast({
    type: 'stroke',
    stroke,
    index,
    term
  });
  
  res.json({ success: true });
});
```

**What this does:**
- When leader commits a stroke to the log, it notifies gateway
- Gateway broadcasts to all clients

**Usage:**
```
Replica1 (LEADER):
  User's stroke now has 3/3 votes (replicated to all 3 nodes)
  → Calls: POST http://gateway:3000/commit-stroke
  {
    "stroke": { id: "abc123", x: 100, y: 150, ... },
    "index": 9,
    "term": 10
  }
  ↓
Gateway:
  broadcast({
    type: 'stroke',
    stroke: { id: "abc123", ... }
  })
  ↓
All connected browsers receive:
  { type: 'stroke', stroke: { id: "abc123", ... } }
  ↓
Browsers draw the stroke!
```

---

### Lines 292-300: Health Check

```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    clients: clients.size,
    leader: currentLeader,
    term: currentTerm
  });
});
```

**What this does:**
- Returns current gateway status
- Used by monitoring systems

**Example response:**
```json
{
  "status": "healthy",
  "clients": 3,
  "leader": "replica1",
  "term": 10
}
```

---

### Lines 302-351: Full Status (Cluster Overview)

```javascript
app.get('/status', async (req, res) => {
  const clusterStatus = await Promise.all(
    REPLICA_URLS.map(async (url) => {
      const cachedEntry = replicaCache.get(url);
      const now = Date.now();
      
      if (!cachedEntry || (now - (cachedEntry.lastUpdated || 0)) > 1000) {
        try {
          const response = await axios.get(`${url}/state`, { timeout: 500 });
          const entry = {
            url,
            nodeId: response.data.nodeId,
            role: response.data.role,
            term: response.data.term,
            leaderId: response.data.leaderId,
            healthy: true,
            lastUpdated: now
          };
          replicaCache.set(url, entry);
          return entry;
        } catch (error) {
          const entry = {
            url,
            healthy: false,
            error: error.message,
            lastUpdated: now
          };
          replicaCache.set(url, entry);
          return entry;
        }
      }
      
      return cachedEntry;
    })
  );
  
  res.json({
    gateway: {
      clients: clients.size,
      currentLeader,
      currentTerm
    },
    replicas: clusterStatus
  });
});
```

**What this does:**
- Returns full cluster status including all replicas
- Uses cache to avoid querying too often
- Updates cache if data is older than 1 second

**Example response:**
```json
{
  "gateway": {
    "clients": 3,
    "currentLeader": "replica1",
    "currentTerm": 10
  },
  "replicas": [
    {
      "url": "http://replica1:4001",
      "nodeId": "replica1",
      "role": "leader",
      "term": 10,
      "healthy": true
    },
    {
      "url": "http://replica2:4002",
      "nodeId": "replica2",
      "role": "follower",
      "term": 10,
      "healthy": true
    },
    {
      "url": "http://replica3:4003",
      "nodeId": "replica3",
      "role": "follower",
      "term": 10,
      "healthy": true
    }
  ]
}
```

---

## Broadcasting

### Lines 356-371: Broadcast to All

```javascript
function broadcast(message) {
  const messageStr = JSON.stringify(message);
  let sent = 0;
  
  clients.forEach((ws, clientId) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(messageStr);
      sent++;
    }
  });
  
  if (message.type !== 'draw-point' && message.type !== 'draw-start') {
    log(`Broadcast message to ${sent} clients`, { type: message.type });
  }
}
```

**What this does:**
1. Loop through all connected clients
2. Send message to each one (if connection is open)
3. Skip logging for `draw-point` (too many per second)

**Examples:**
```javascript
// Broadcast to all 5 clients
broadcast({
  type: 'stroke',
  stroke: { id: "123", x: 100, y: 150 }
});
// Sends to all 5 browsers simultaneously

// Broadcast leader change
broadcast({
  type: 'leader-change',
  leader: 'replica2',
  term: 11
});
// All browsers update their UI to show new leader
```

---

### Lines 373-383: Broadcast to Others (Exclude Sender)

```javascript
function broadcastToOthers(excludeClientId, message) {
  const messageStr = JSON.stringify(message);
  
  clients.forEach((ws, clientId) => {
    if (clientId !== excludeClientId && ws.readyState === ws.OPEN) {
      ws.send(messageStr);
    }
  });
}
```

**What this does:**
- Send to all clients EXCEPT the sender
- Used for live drawing (don't send back to user who already drew it)

**Example:**
```
Browser1 is drawing, sending draw-point messages

Browser1 sends: { type: 'draw-point', x: 100, y: 150 }
  ↓
Gateway receives from clientId: "abc123"
  ↓
broadcastToOthers("abc123", { type: 'draw-point', x: 100, y: 150 })
  ↓
Sends to: Browser2, Browser3, Browser4, Browser5
  ↓
Sends to: Browser1? NO! (excluded)

Result: Everyone sees Browser1 drawing in real-time
        But Browser1 doesn't get their own message back
```

---

## Complete Flow Examples

### Example 1: User Draws a Stroke

```
Timeline:
────────────────────────────────────────

T=0ms:
Browser User draws on canvas
  ↓
Frontend JavaScript:
  canvas.addEventListener('mousemove', (e) => {
    ws.send({
      type: 'stroke',
      stroke: { x: 100, y: 150, color: '#FF0000', ... }
    });
  });
  ↓
Gateway receives on /ws connection

────────────────────────────────────────

T=5ms:
Gateway's ws.on('message'):
  const data = JSON.parse(message);
  if (data.type === 'stroke') {
    await handleStroke(data.stroke, clientId);
  }
  ↓
handleStroke():
  stroke.id = uuidv4();           // "abc-123-def-456"
  stroke.clientId = clientId;     // "client-789"
  stroke.timestamp = Date.now();  // 1714012052000
  
  POST http://replica1:4001/stroke
  {
    "stroke": { id: "abc-123-def-456", x: 100, y: 150, ... }
  }

────────────────────────────────────────

T=10ms:
Replica1 (LEADER) receives stroke
  ↓
Appends to log:
  [... existing strokes ..., { term: 10, stroke: {...} }]
  ↓
Saves to disk: /data/raft-log.json
  ↓
Sends /append-entries to replica2 and replica3
  {
    term: 10,
    entries: [{ term: 10, stroke: {...} }],
    ...
  }

────────────────────────────────────────

T=15ms:
Replica2 and Replica3 receive /append-entries
  ↓
Both append to their logs
  ↓
Both save to disk
  ↓
Both send ACK back to Replica1

────────────────────────────────────────

T=20ms:
Replica1 receives 2 ACKs (3/3 total with self)
  ↓
MAJORITY! ✓
  ↓
Updates commitIndex = 9
  ↓
Saves state to disk
  ↓
Sends /commit-stroke to gateway:
  {
    stroke: { id: "abc-123-def-456", x: 100, y: 150, ... },
    index: 9,
    term: 10
  }

────────────────────────────────────────

T=25ms:
Gateway receives /commit-stroke
  ↓
broadcast({
  type: 'stroke',
  stroke: { id: "abc-123-def-456", x: 100, y: 150, ... },
  index: 9,
  term: 10
})
  ↓
Sends to all 5 connected browsers

────────────────────────────────────────

T=30ms:
All 5 browsers receive:
  {
    type: 'stroke',
    stroke: { id: "abc-123-def-456", x: 100, y: 150, ... }
  }
  ↓
Frontend JavaScript:
  ws.on('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'stroke') {
      drawStrokeOnCanvas(msg.stroke);
    }
  });
  ↓
All 5 canvases now show the same stroke! ✓

────────────────────────────────────────

TOTAL TIME: ~30ms from drawing to all canvases showing it
```

---

### Example 2: Leader Crashes During Replication

```
Timeline:
────────────────────────────────────────

T=0s:
Replica1 is LEADER
  currentLeader = "replica1"
  currentLeaderUrl = "http://replica1:4001"
  
Gateway is routing all strokes to replica1

────────────────────────────────────────

T=5s:
User draws a stroke
  ↓
Gateway: POST to replica1/stroke
  ↓
Replica1 receives, appends to log
  ↓
Replica1 sends /append-entries to replica2, replica3
  ↓
Replica1 CRASHES before receiving ACKs! ❌

────────────────────────────────────────

T=6s:
Container stops
  Replica1 logs stop appearing

────────────────────────────────────────

T=6s:
Gateway's polling interval runs:
  GET http://replica1:4001/state
  CONNECTION TIMEOUT! ❌
  
  log('Lost connection to leader, discovering new leader');
  currentLeader = null;
  currentLeaderUrl = null;
  await discoverLeader();
  ↓
discoverLeader():
  Try replica2:
    GET http://replica2:4001/state
    response.data.role === 'leader'? 
    Not yet, replica2 is still FOLLOWER
  
  Try replica3:
    GET http://replica3:4003/state
    response.data.role === 'leader'?
    Not yet, still FOLLOWER
  
  All are followers → No leader yet, cluster electing

────────────────────────────────────────

T=6-7s:
Replica2 and Replica3 timeout waiting for heartbeat
  ↓
Both start elections (see earlier log replay)
  ↓
One becomes LEADER (e.g., replica2)

────────────────────────────────────────

T=7s:
Replica2 (NEW LEADER) sends /leader-update to gateway:
  POST http://gateway:3000/leader-update
  {
    leaderId: "replica2",
    leaderUrl: "http://replica2:4002",
    term: 11
  }
  ↓
Gateway receives:
  currentLeader = "replica2"
  currentLeaderUrl = "http://replica2:4002"
  ↓
broadcast({
    type: 'leader-change',
    leader: 'replica2',
    term: 11
  })
  ↓
All browsers update their UI: "Leader: replica2"

────────────────────────────────────────

T=7s:
New strokes are now sent to replica2 instead of replica1
  ↓
System continues normally!

────────────────────────────────────────

T=10s:
Replica1 comes back online:
  Loads saved state from disk
  Sees term=11 (newer than its term=10)
  Becomes FOLLOWER
  Requests missing entries from replica2
  Syncs the stroke that was replicated during crash
  Continues normally ✓

────────────────────────────────────────

RESULT: No data loss, system kept working!
        Users briefly saw "No leader, cluster electing"
        But recovered in ~1-2 seconds
```

---

## Summary

| Responsibility | How | Where |
|---|---|---|
| **Manage clients** | Map of WebSocket connections | `clients` Map |
| **Find leader** | Query all replicas' `/state` endpoint | `discoverLeader()` function |
| **Monitor leader** | Every 1s check if leader is still leader | `setInterval` loop |
| **Route strokes** | POST to `currentLeaderUrl/stroke` | `handleStroke()` function |
| **Handle failover** | Retry with new leader, 3 attempts | `handleStroke()` retry logic |
| **Broadcast updates** | Send to all clients via WebSocket | `broadcast()` function |
| **Real-time drawing** | Send draw events to other clients | `broadcastToOthers()` function |
| **Sync new clients** | Get full log from any replica on connect | `sendInitialState()` function |
| **Handle replica pushes** | Listen to `/leader-update` and `/commit-stroke` | Express HTTP endpoints |

---

## Key Insights

1. **Gateway is dumb** - It doesn't know about RAFT, just routes to leader
2. **Gateway is resilient** - Recovers from leader crashes automatically
3. **Gateway is fast** - WebSocket for real-time, cache for frequent queries
4. **Gateway is the single point of contact** - Clients never talk to replicas directly
5. **Gateway is transparent** - Leader changes are broadcast to clients so they know status

This is production-grade distributed system design!

