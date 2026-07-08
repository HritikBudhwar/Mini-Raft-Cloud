/**
 * Mini-RAFT Replica Node 3
 * 
 * Implements a simplified RAFT consensus protocol with:
 * - Leader Election
 * - Log Replication (Append-Only Stroke Log)
 * - Heartbeats
 * - Catch-up synchronization for restarted nodes
 * - Persistent storage
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ==================== CONFIGURATION ====================
const NODE_ID = process.env.NODE_ID || 'replica1';
const PORT = parseInt(process.env.PORT) || 4001;
const PEERS = (process.env.PEERS || '').split(',').filter(p => p);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:3000';
const DATA_DIR = process.env.DATA_DIR || '/data';

// RAFT timing constants (per spec)
const HEARTBEAT_INTERVAL = 150; // ms
const ELECTION_TIMEOUT_MIN = 500; // ms - per spec
const ELECTION_TIMEOUT_MAX = 800; // ms - per spec

// ==================== PERSISTENCE ====================
const STATE_FILE = path.join(DATA_DIR, 'raft-state.json');
const LOG_FILE = path.join(DATA_DIR, 'raft-log.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveState() {
  try {
    ensureDataDir();
    const persistentState = {
      currentTerm: state.currentTerm,
      votedFor: state.votedFor,
      commitIndex: state.commitIndex
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(persistentState, null, 2));
  } catch (error) {
    log(`Failed to save state: ${error.message}`);
  }
}

function saveLog() {
  try {
    ensureDataDir();
    fs.writeFileSync(LOG_FILE, JSON.stringify(state.log, null, 2));
  } catch (error) {
    log(`Failed to save log: ${error.message}`);
  }
}

function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      state.currentTerm = data.currentTerm || 0;
      state.votedFor = data.votedFor || null;
      state.commitIndex = data.commitIndex || 0;
      log(`Loaded persisted state: term=${state.currentTerm}, commitIndex=${state.commitIndex}`);
    }
    if (fs.existsSync(LOG_FILE)) {
      state.log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      log(`Loaded persisted log: ${state.log.length} entries`);
    }
  } catch (error) {
    log(`Failed to load persisted state: ${error.message}`);
  }
}

// ==================== RAFT STATE ====================
let state = {
  // Persistent state
  currentTerm: 0,
  votedFor: null,
  log: [], // Append-only stroke log: Array of { term, index, stroke }
  
  // Volatile state
  commitIndex: 0,
  lastApplied: 0,
  
  // Node role: 'follower', 'candidate', 'leader'
  role: 'follower',
  leaderId: null,
  
  // Leader-specific state
  nextIndex: {},
  matchIndex: {},
};

let electionTimeout = null;
let heartbeatInterval = null;

// ==================== UTILITY FUNCTIONS ====================

function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${NODE_ID}] [Term ${state.currentTerm}] [${state.role.toUpperCase()}] ${message}`, 
    Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}

function getRandomElectionTimeout() {
  return Math.floor(Math.random() * (ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN + 1)) + ELECTION_TIMEOUT_MIN;
}

function getLastLogIndex() {
  return state.log.length;
}

function getLastLogTerm() {
  return state.log.length > 0 ? state.log[state.log.length - 1].term : 0;
}

// ==================== ELECTION TIMEOUT ====================

function resetElectionTimeout() {
  if (electionTimeout) {
    clearTimeout(electionTimeout);
  }
  
  const timeout = getRandomElectionTimeout();
  electionTimeout = setTimeout(() => {
    if (state.role !== 'leader') {
      log('Election timeout - starting election');
      startElection();
    }
  }, timeout);
}

function stopElectionTimeout() {
  if (electionTimeout) {
    clearTimeout(electionTimeout);
    electionTimeout = null;
  }
}

// ==================== HEARTBEAT (Leader only) ====================

function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  sendHeartbeats();
  
  heartbeatInterval = setInterval(() => {
    if (state.role === 'leader') {
      sendHeartbeats();
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

async function sendHeartbeats() {
  const promises = PEERS.map(async (peerUrl) => {
    try {
      const prevLogIndex = state.nextIndex[peerUrl] ? state.nextIndex[peerUrl] - 1 : getLastLogIndex();
      const prevLogTerm = prevLogIndex > 0 && state.log[prevLogIndex - 1] 
        ? state.log[prevLogIndex - 1].term 
        : 0;
      
      const entries = state.log.slice(state.nextIndex[peerUrl] ? state.nextIndex[peerUrl] - 1 : state.log.length);
      
      const response = await axios.post(`${peerUrl}/append-entries`, {
        term: state.currentTerm,
        leaderId: NODE_ID,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: state.commitIndex
      }, { timeout: 100 });
      
      if (response.data.success) {
        if (entries.length > 0) {
          state.nextIndex[peerUrl] = getLastLogIndex() + 1;
          state.matchIndex[peerUrl] = getLastLogIndex();
        }
      } else if (response.data.term > state.currentTerm) {
        becomeFollower(response.data.term);
      } else if (!response.data.success && response.data.conflictIndex !== undefined) {
        log(`Log inconsistency with ${peerUrl}, syncing from index ${response.data.conflictIndex}`);
        await syncFollower(peerUrl, response.data.conflictIndex);
      }
    } catch (error) {
      // Peer unavailable
    }
  });
  
  await Promise.allSettled(promises);
}

async function syncFollower(peerUrl, fromIndex) {
  try {
    const entries = state.log.slice(fromIndex);
    const response = await axios.post(`${peerUrl}/sync-log`, {
      term: state.currentTerm,
      leaderId: NODE_ID,
      fromIndex,
      entries,
      leaderCommit: state.commitIndex
    }, { timeout: 1000 });
    
    if (response.data.success) {
      state.nextIndex[peerUrl] = getLastLogIndex() + 1;
      state.matchIndex[peerUrl] = getLastLogIndex();
      log(`Successfully synced ${peerUrl} from index ${fromIndex}`);
    }
  } catch (error) {
    log(`Failed to sync ${peerUrl}: ${error.message}`);
  }
}

// ==================== ROLE TRANSITIONS ====================

function becomeFollower(term, leaderId = null) {
  log(`Becoming FOLLOWER for term ${term}`, { leaderId });
  state.role = 'follower';
  state.currentTerm = term;
  state.votedFor = null;
  state.leaderId = leaderId;
  saveState();
  
  stopHeartbeat();
  resetElectionTimeout();
}

function becomeCandidate() {
  log('Becoming CANDIDATE');
  state.role = 'candidate';
  state.currentTerm++;
  state.votedFor = NODE_ID;
  state.leaderId = null;
  saveState();
  
  stopHeartbeat();
  resetElectionTimeout();
}

function becomeLeader() {
  log('Becoming LEADER');
  state.role = 'leader';
  state.leaderId = NODE_ID;
  
  PEERS.forEach(peer => {
    state.nextIndex[peer] = getLastLogIndex() + 1;
    state.matchIndex[peer] = 0;
  });
  
  stopElectionTimeout();
  startHeartbeat();
  notifyGatewayOfLeader();
}

async function notifyGatewayOfLeader() {
  try {
    await axios.post(`${GATEWAY_URL}/leader-update`, {
      leaderId: NODE_ID,
      leaderUrl: `http://${NODE_ID}:${PORT}`,
      term: state.currentTerm
    }, { timeout: 500 });
    log('Notified gateway of leadership');
  } catch (error) {
    log('Failed to notify gateway of leadership');
  }
}

// ==================== ELECTION ====================

async function startElection() {
  becomeCandidate();
  
  let votesReceived = 1;
  let peersResponded = 0;
  
  const votePromises = PEERS.map(async (peerUrl) => {
    try {
      const response = await axios.post(`${peerUrl}/request-vote`, {
        term: state.currentTerm,
        candidateId: NODE_ID,
        lastLogIndex: getLastLogIndex(),
        lastLogTerm: getLastLogTerm()
      }, { timeout: 300 });
      
      if (response.data.term > state.currentTerm) {
        becomeFollower(response.data.term);
        return { responded: true, granted: false };
      }
      
      return { responded: true, granted: response.data.voteGranted };
    } catch (error) {
      return { responded: false, granted: false };
    }
  });
  
  const results = await Promise.allSettled(votePromises);
  
  if (state.role === 'candidate') {
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        if (result.value.responded) {
          peersResponded++;
          if (result.value.granted) {
            votesReceived++;
          }
        }
      }
    });
    
    // Dynamic quorum: if less than half of peers respond, calculate quorum based on responding peers
    // This allows a single node to become leader if others are down
    const totalNodes = PEERS.length + 1;
    const respondingNodes = peersResponded + 1; // +1 for self
    const votesNeeded = Math.floor(respondingNodes / 2) + 1;
    
    log(`Election results: ${votesReceived}/${respondingNodes} votes (need ${votesNeeded})`);
    
    if (votesReceived >= votesNeeded) {
      becomeLeader();
    } else {
      resetElectionTimeout();
    }
  }
}

// ==================== RPC ENDPOINTS ====================

// RequestVote RPC
app.post('/request-vote', (req, res) => {
  const { term, candidateId, lastLogIndex, lastLogTerm } = req.body;
  
  log(`Received vote request from ${candidateId}`, { term, lastLogIndex, lastLogTerm });
  
  if (term > state.currentTerm) {
    becomeFollower(term);
  }
  
  let voteGranted = false;
  
  // FIX: Only allow voting in the current term, and only if we haven't voted yet or voted for this candidate
  if (term === state.currentTerm && 
      (state.votedFor === null || state.votedFor === candidateId)) {
    
    const ourLastLogTerm = getLastLogTerm();
    const ourLastLogIndex = getLastLogIndex();
    
    const candidateLogUpToDate = 
      (lastLogTerm > ourLastLogTerm) ||
      (lastLogTerm === ourLastLogTerm && lastLogIndex >= ourLastLogIndex);
    
    if (candidateLogUpToDate) {
      voteGranted = true;
      state.votedFor = candidateId;
      saveState();
      resetElectionTimeout();
      log(`Granted vote to ${candidateId}`);
    }
  }
  
  res.json({
    term: state.currentTerm,
    voteGranted
  });
});

// AppendEntries RPC
app.post('/append-entries', (req, res) => {
  const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } = req.body;
  
  if (term < state.currentTerm) {
    return res.json({ term: state.currentTerm, success: false });
  }
  
  if (term >= state.currentTerm) {
    if (state.role !== 'follower' || state.currentTerm !== term) {
      becomeFollower(term, leaderId);
    }
    state.leaderId = leaderId;
  }
  
  resetElectionTimeout();
  
  if (prevLogIndex > 0) {
    if (state.log.length < prevLogIndex) {
      log(`Log too short, have ${state.log.length}, need ${prevLogIndex}`);
      return res.json({ 
        term: state.currentTerm, 
        success: false,
        conflictIndex: state.log.length
      });
    }
    
    if (state.log[prevLogIndex - 1] && state.log[prevLogIndex - 1].term !== prevLogTerm) {
      log(`Term mismatch at index ${prevLogIndex}`);
      return res.json({ 
        term: state.currentTerm, 
        success: false,
        conflictIndex: prevLogIndex - 1
      });
    }
  }
  
  // Append new entries (append-only)
  if (entries && entries.length > 0) {
    state.log = state.log.slice(0, prevLogIndex);
    state.log.push(...entries);
    saveLog();
    log(`Appended ${entries.length} entries, log size: ${state.log.length}`);
  }
  
  if (leaderCommit > state.commitIndex) {
    state.commitIndex = Math.min(leaderCommit, getLastLogIndex());
    saveState();
    log(`Updated commitIndex to ${state.commitIndex}`);
  }
  
  res.json({ term: state.currentTerm, success: true });
});

// Sync-Log RPC
app.post('/sync-log', (req, res) => {
  const { term, leaderId, fromIndex, entries, leaderCommit } = req.body;
  
  log(`Sync-log request from ${leaderId}`, { fromIndex, entriesCount: entries?.length });
  
  if (term < state.currentTerm) {
    return res.json({ term: state.currentTerm, success: false });
  }
  
  if (term >= state.currentTerm) {
    becomeFollower(term, leaderId);
  }
  
  if (entries && entries.length > 0) {
    state.log = state.log.slice(0, fromIndex);
    state.log.push(...entries);
    saveLog();
    log(`Synced log, now have ${state.log.length} entries`);
  }
  
  if (leaderCommit > state.commitIndex) {
    state.commitIndex = Math.min(leaderCommit, getLastLogIndex());
    saveState();
  }
  
  resetElectionTimeout();
  
  res.json({ term: state.currentTerm, success: true });
});

// Heartbeat RPC (Explicit endpoint - alternative to AppendEntries with empty entries)
app.post('/heartbeat', (req, res) => {
  const { term, leaderId, leaderCommit } = req.body;
  
  if (term < state.currentTerm) {
    return res.json({ term: state.currentTerm, success: false });
  }
  
  if (term >= state.currentTerm) {
    if (state.role !== 'follower' || state.currentTerm !== term) {
      becomeFollower(term, leaderId);
    }
    state.leaderId = leaderId;
  }
  
  resetElectionTimeout();
  
  if (leaderCommit > state.commitIndex) {
    state.commitIndex = Math.min(leaderCommit, getLastLogIndex());
    saveState();
  }
  
  res.json({ term: state.currentTerm, success: true });
});

// ==================== CLIENT-FACING ENDPOINTS ====================

// Receive stroke from gateway (leader only)
app.post('/stroke', async (req, res) => {
  const { stroke } = req.body;
  
  if (state.role !== 'leader') {
    return res.status(503).json({ 
      error: 'Not leader', 
      leaderId: state.leaderId,
      leaderUrl: state.leaderId ? `http://${state.leaderId}:${getPortFromNodeId(state.leaderId)}` : null
    });
  }
  
  log('Received stroke from gateway', { strokeId: stroke.id });
  
  // Create log entry (append-only)
  const entry = {
    term: state.currentTerm,
    index: getLastLogIndex() + 1,
    stroke
  };
  
  // Append to local log
  state.log.push(entry);
  saveLog();
  
  // Replicate to followers
  let acks = 1;
  const acksNeeded = Math.floor((PEERS.length + 1) / 2) + 1;
  
  const replicationPromises = PEERS.map(async (peerUrl) => {
    try {
      const prevLogIndex = entry.index - 1;
      const prevLogTerm = prevLogIndex > 0 ? state.log[prevLogIndex - 1].term : 0;
      
      const response = await axios.post(`${peerUrl}/append-entries`, {
        term: state.currentTerm,
        leaderId: NODE_ID,
        prevLogIndex,
        prevLogTerm,
        entries: [entry],
        leaderCommit: state.commitIndex
      }, { timeout: 200 });
      
      if (response.data.success) {
        state.matchIndex[peerUrl] = entry.index;
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  });
  
  const results = await Promise.allSettled(replicationPromises);
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value) acks++;
  });
  
  log(`Replication complete: ${acks}/${PEERS.length + 1} acks`);
  
  if (acks >= acksNeeded) {
    state.commitIndex = entry.index;
    saveState();
    
    try {
      await axios.post(`${GATEWAY_URL}/commit-stroke`, {
        stroke: entry.stroke,
        index: entry.index,
        term: state.currentTerm
      }, { timeout: 200 });
      log('Committed stroke and notified gateway');
    } catch (error) {
      log('Failed to notify gateway of commit');
    }
    
    res.json({ success: true, index: entry.index });
  } else {
    res.json({ success: true, index: entry.index, pending: true });
  }
});

// Get current state
app.get('/state', (req, res) => {
  res.json({
    nodeId: NODE_ID,
    role: state.role,
    term: state.currentTerm,
    leaderId: state.leaderId,
    logLength: state.log.length,
    commitIndex: state.commitIndex,
    votedFor: state.votedFor,
    peers: PEERS
  });
});

// Get full log
app.get('/log', (req, res) => {
  res.json({
    nodeId: NODE_ID,
    log: state.log,
    commitIndex: state.commitIndex
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    nodeId: NODE_ID,
    role: state.role,
    term: state.currentTerm
  });
});

// ==================== HELPER ====================

function getPortFromNodeId(nodeId) {
  const portMap = {
    'replica1': 4001,
    'replica2': 4002,
    'replica3': 4003
  };
  return portMap[nodeId] || 4001;
}

// ==================== STARTUP ====================

app.listen(PORT, () => {
  log(`Starting on port ${PORT}`);
  log(`Peers: ${PEERS.join(', ')}`);
  log(`Data directory: ${DATA_DIR}`);
  
  loadPersistedState();
  
  // IMPORTANT: On startup, wait a bit longer before starting election timeout
  // This gives the existing leader time to send us a heartbeat
  // A restarted node should rejoin as follower, not trigger unnecessary elections
  const startupDelay = ELECTION_TIMEOUT_MAX + 200; // Wait longer than max election timeout
  log(`Waiting ${startupDelay}ms before joining cluster (allowing leader heartbeat)...`);
  
  setTimeout(() => {
    log('Startup delay complete, now participating in cluster');
    resetElectionTimeout();
  }, startupDelay);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down gracefully');
  stopHeartbeat();
  stopElectionTimeout();
  process.exit(0);
});

console.log("faah")

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down gracefully');
  stopHeartbeat();
  stopElectionTimeout();
  process.exit(0);
});
console.log("hello world hewll")