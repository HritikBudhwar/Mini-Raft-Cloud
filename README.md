# Distributed Real-Time Drawing Board with Mini-RAFT Consensus

A fault-tolerant, real-time collaborative drawing application using Mini-RAFT consensus protocol.

## 📁 Project Structure

```
distributed-drawing-board/
├── docker-compose.yml          # Orchestrates all services
├── README.md                   # This file
├── frontend/                   # Browser UI
│   ├── Dockerfile
│   ├── nginx.conf
│   └── index.html
├── gateway/                    # WebSocket Gateway
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── replica1/                   # RAFT Node 1
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── data/                   # Persistent storage
├── replica2/                   # RAFT Node 2
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── data/                   # Persistent storage
├── replica3/                   # RAFT Node 3
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── data/                   # Persistent storage
└── logs/                       # Sample failover logs
    └── FAILOVER_LOGS.md
```

## 🚀 Quick Start

```bash
# Build and start all services
docker-compose up --build

# Or run in detached mode
docker-compose up --build -d
```

## 🌐 Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:8080 | Drawing canvas UI |
| Gateway | http://localhost:3000/health | Gateway health check |
| Cluster Status | http://localhost:3000/status | Full cluster status |
| Replica 1 | http://localhost:4001/state | Node 1 state |
| Replica 2 | http://localhost:4002/state | Node 2 state |
| Replica 3 | http://localhost:4003/state | Node 3 state |

## 🧪 Testing Failover

```bash
# Check current leader
curl http://localhost:3000/status | jq '.gateway.currentLeader'

# Kill the leader (e.g., replica1)
docker-compose stop replica1

# Watch new election in logs
docker-compose logs -f replica2 replica3

# Verify new leader
curl http://localhost:3000/status | jq '.gateway.currentLeader'

# Restart the old leader
docker-compose start replica1

# Verify it rejoins and syncs
curl http://localhost:4001/state
```

## 📝 Key Features

- **Mini-RAFT Consensus**: Leader election, log replication, heartbeats
- **Append-Only Stroke Log**: Immutable log for consistency
- **Fault Tolerance**: Survives 1 of 3 node failures
- **Real-Time Sync**: Live drawing visible across all clients
- **Persistent Storage**: Each replica has its own data directory
- **Hot Reload**: Code changes apply without restart (nodemon)

## 🔧 Architecture

```
Browsers ──WebSocket──► Gateway ──HTTP──► RAFT Cluster
                                          ├── Replica1 (data/)
                                          ├── Replica2 (data/)
                                          └── Replica3 (data/)
```

## 📊 RAFT Parameters

| Parameter | Value |
|-----------|-------|
| Election Timeout | 500-800ms (random) |
| Heartbeat Interval | 150ms |
| Majority Quorum | 2 of 3 |
