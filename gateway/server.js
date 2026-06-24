/**
 * Gateway Service
 * 
 * Manages WebSocket connections from browser clients and routes
 * drawing strokes to the RAFT cluster leader.
 * 
 * Responsibilities:
 * - Accept browser WebSocket connections
 * - Forward strokes to current leader
 * - Broadcast committed strokes to all clients
 * - Handle leader failover gracefully
 * - Broadcast live drawing points in real-time
 */

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

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const REPLICA_URLS = (process.env.REPLICA_URLS || 'http://replica1:4001,http://replica2:4002,http://replica3:4003')
  .split(',')
  .filter(u => u);

// ==================== STATE ====================
let currentLeader = null;
let currentLeaderUrl = null;
let currentTerm = 0;
const clients = new Map(); // clientId -> ws
let replicaCache = new Map(); // url -> { role, term, nodeId, healthy, lastUpdated }

// ==================== LOGGING ====================
function log(message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [GATEWAY] ${message}`, 
    Object.keys(data).length > 0 ? JSON.stringify(data) : '');
}

// ==================== LEADER DISCOVERY ====================
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

// Periodically check leader status
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

// ==================== WEBSOCKET HANDLING ====================

wss.on('connection', async (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  
  log(`Client connected: ${clientId}`, { totalClients: clients.size });
  
  await sendInitialState(ws, clientId);
  
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
  
  ws.on('close', () => {
    clients.delete(clientId);
    log(`Client disconnected: ${clientId}`, { totalClients: clients.size });
  });
  
  ws.on('error', (error) => {
    log(`WebSocket error for ${clientId}: ${error.message}`);
    clients.delete(clientId);
  });
});

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

// ==================== HTTP ENDPOINTS ====================

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

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    clients: clients.size,
    leader: currentLeader,
    term: currentTerm
  });
});

app.get('/status', async (req, res) => {
  // Build status from cache and refresh stale entries
  const clusterStatus = await Promise.all(
    REPLICA_URLS.map(async (url) => {
      const cachedEntry = replicaCache.get(url);
      const now = Date.now();
      
      // If cache is older than 1 second, refresh it
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

// ==================== BROADCAST ====================

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

function broadcastToOthers(excludeClientId, message) {
  const messageStr = JSON.stringify(message);
  
  clients.forEach((ws, clientId) => {
    if (clientId !== excludeClientId && ws.readyState === ws.OPEN) {
      ws.send(messageStr);
    }
  });
}

// ==================== STARTUP ====================

server.listen(PORT, async () => {
  log(`Gateway started on port ${PORT}`);
  log(`Replica URLs: ${REPLICA_URLS.join(', ')}`);
  
  setTimeout(discoverLeader, 2000);
});

process.on('SIGTERM', () => {
  log('Shutting down gracefully');
  wss.close();
  server.close();
  process.exit(0);
});
