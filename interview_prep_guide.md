# Interview Preparation Guide: Distributed Drawing Board with Mini-RAFT Consensus

Use this guide to prepare for your interview. It is structured to help you explain the project to an experienced interviewer (19+ years in the industry) who will probe for architectural depth, edge cases, distributed system trade-offs, and real-world troubleshooting experience.

---

## 1. The Elevator Pitch (How to Introduce the Project)
> *"For this project, I built a fault-tolerant, real-time collaborative drawing application. The core challenge is maintaining a consistent drawing canvas across multiple users even if network partitions occur or individual servers fail. To solve this, I implemented a custom **Mini-RAFT consensus protocol** from scratch in Node.js. It features a stateless WebSocket Gateway layer for scaling real-time client traffic, backed by a stateful 3-node consensus cluster that replicates brush strokes using an append-only log and handles automatic leader election with randomized timeouts."*

---

## 2. Technical Architecture & Component Breakdown

```
  [ Client Browsers ]
          │ (WebSocket: draw-start, draw-point, draw-end, stroke)
          ▼
   [ Gateway Server ] (Stateless Port 3000)
          │ (HTTP POST: /append-entry)
          ▼
  ┌────────────────────────────────────────────────────────┐
  │                 RAFT Consensus Cluster                 │
  │                                                        │
  │  ┌───────────────┐   ┌───────────────┐   ┌──────────┐  │
  │  │   Replica 1   │   │   Replica 2   │   │ Replica3 │  │
  │  │ (Leader: 4001)│   │(Follower:4002)│   │(Follower)│  │
  │  └───────┬───────┘   └───────────────┘   └──────────┘  │
  └──────────┼─────────────────────────────────────────────┘
             ▼ (Disk Persistence)
     [ raft-log.json ]
     [ raft-state.json ]
```

### 1. Client Layer (Frontend NGINX)
*   **Technologies**: HTML5 Canvas, Vanilla Javascript, NGINX.
*   **Mechanism**: Captures mouse/touch gestures, converts coordinates, and sends low-latency drawing events (`draw-start`, `draw-point`, `draw-end`) to the Gateway via WebSockets. It also listens for committed strokes to render the final canvas consistently.

### 2. API Layer (WebSocket Gateway)
*   **Technologies**: Node.js, Express, `ws` (WebSockets), `axios`.
*   **Key Design**: **Stateless and decoupling**. Clients connect *only* to the Gateway. The Gateway continuously queries the replica cluster to discover the current leader, caches it, and proxies committed strokes to the leader via HTTP. If a leader crashes, the Gateway handles reconnection and redirects new strokes to the newly elected leader.

### 3. Consensus Layer (Replicas 1, 2, 3)
*   **Technologies**: Node.js, Express, Axios.
*   **Key Design**: State machine running follower, candidate, or leader roles. Implements log replication, term management, request-vote logic, and heartbeat loops.
*   **Storage**: Each replica persists two files to disk:
    *   `raft-log.json`: The append-only, ordered log of strokes.
    *   `raft-state.json`: Critical consensus metadata (`currentTerm`, `votedFor`, `commitIndex`).

---

## 3. Why Choose This Project Under "Cloud"?

An interviewer with 19 years of experience wants to know *why* you chose this instead of a simple CRUD app. Here is how to justify it:

1.  **Consensus is the Bedrock of Cloud Infrastructure**: Modern cloud tools like Kubernetes (using `etcd`), service registries (like `Consul` or `ZooKeeper`), and distributed databases (like CockroachDB or Amazon Aurora) rely on Paxos or Raft. Building a custom Raft implementation shows you understand how cloud providers achieve high availability and consistency at scale.
2.  **Decoupling Stateful vs. Stateless Layers**: In cloud architectures, we aim to make the entry point (WebSockets/Gateway) stateless so it can scale horizontally. The stateful layer (consensus cluster) handles the complex consistency logic separately. This project mirrors that enterprise-grade pattern.
3.  **Resilience & Fault Domains**: It directly demonstrates recovery inside a virtual cloud network (Docker network). If a node fails, the cluster heals itself. This aligns with cloud principles of *Design for Failure*.

---

## 4. Key Engineering Challenges Faced & How You Overcame Them

This is the most critical part of a senior-level interview. Frame these as "production issues" that you diagnosed and resolved:

### Challenge 1: Log Buffering and Silent Process Terminations in Containerized Environments
*   **Symptom**: During replica crash testing or code hot-reloads, stdout logs from restarted replica containers suddenly stopped displaying in the parent `docker-compose logs` terminal, making it impossible to debug leader elections.
*   **Root Cause**: Node.js stdout stream is buffered by default when running in a non-TTY environment like Docker. Furthermore, when `nodemon` detected a file change and spawned a new Node.js child process, the child did not inherit the terminal's flushing flags.
*   **Solution**:
    1.  Modified the replica `Dockerfiles` to install `coreutils` (providing `stdbuf`) and changed the launch command to `sh -c "stdbuf -o0 nodemon server.js"`.
    2.  Configured the `nodemon.json` config in each service, adding `"exec": "stdbuf -o0 node"`. This forced both the parent container and every hot-reloaded child process spawned by nodemon to run with completely unbuffered stdout (`-o0`), instantly making logs visible.

### Challenge 2: Spec-Compliant RPC Segmentation (Implicit vs. Explicit Heartbeats)
*   **Symptom**: Originally, heartbeats were sent implicitly using empty `AppendEntries` RPC payloads. During audits, we realized this lacked strict specification compliance and made debugging difficult, as normal heartbeats were indistinguishable from empty log synchronizations.
*   **Root Cause**: Standard Raft allows empty AppendEntries as heartbeats, but combining the execution paths makes testing individual node responsiveness and network path health harder to monitor.
*   **Solution**: Created an explicit `POST /heartbeat` RPC endpoint on all replicas. The leader issues heartbeats every 150ms. Followers use this endpoint to validate terms, step down if a higher term is found, reset their election timeouts, and update their commit index without parsing log-related payloads.

---

## 5. Probing Interview Questions & Strategic Answers

Here are tough questions a 19-year veteran interviewer is likely to ask:

### Q1: What happens if there is a network partition? (Split-Brain)
*   **Interviewer Intent**: Checking if you understand quorum mechanics.
*   **Answer**: *"Because we have 3 nodes, a partition will split the cluster into a minority partition of 1 node and a majority partition of 2 nodes. 
    *   The node in the minority partition cannot win an election (needs 2 votes) and cannot commit writes (needs acknowledgment from 2 nodes).
    *   The 2 nodes in the majority partition can still form a quorum, elect a leader, and continue committing writes.
    *   When the network heals, the minority node receives a heartbeat from the leader with a higher term, steps down, and synchronizes its log using `/sync-log` to catch up. Raft guarantees no split-brain or data loss."*

### Q2: What are the performance bottlenecks in this design, and how would you scale it?
*   **Interviewer Intent**: Assessing your real-world scalability mindset.
*   **Answer**: 
    1.  **State Machine Size**: Currently, the entire log is loaded into memory. For large drawings, this will cause memory exhaustion. I would implement **Log Compaction/Snapshotting** (discarding older logs and keeping only the final canvas state).
    2.  **Write Throughput**: Every brush stroke goes through HTTP POST consensus. I would introduce **stroke batching** on the client or gateway level so multiple coordinates are committed in a single Raft log entry.
    3.  **Network Bandwidth**: Followers receive full log streams. I would compress coordinates using algorithms like *Douglas-Peucker* to reduce bandwidth.

### Q3: Why did you use randomized election timeouts (300ms - 450ms)? What if they were static?
*   **Interviewer Intent**: Testing your grasp of Raft's liveness guarantees.
*   **Answer**: *"If the timeouts were static (e.g., exactly 300ms for all nodes), when the leader dies, all followers would timeout and start elections at the exact same millisecond. Each would vote for itself, resulting in a split vote. No candidate would achieve a majority. The system would enter a livelock state where elections fail repeatedly. Randomizing the timeout ensures that one node always times out first, requests votes, and secures a majority before other nodes can trigger competing elections."*

### Q4: If a follower node crashes and is offline for 2 hours, how does it catch up?
*   **Interviewer Intent**: Checking your understanding of log recovery.
*   **Answer**: *"Upon reboot, the follower reads `raft-state.json` and `raft-log.json` from disk to restore its term and commit index. When the leader sends its regular heartbeat, it detects that the follower's log is stale (the leader's `nextIndex[follower]` points to an index higher than the follower's actual log length). The leader then initiates the log synchronization protocol, sending the missing entries starting from the follower's last acknowledged index until the follower is fully caught up."*
