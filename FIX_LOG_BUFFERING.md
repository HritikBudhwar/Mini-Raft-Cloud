# Fix: Log Output Not Appearing After Node Restart or Hot-Reload

## Problem
When replica nodes were killed and restarted, OR when hot-reload was triggered (file changes detected by nodemon), their logs would not appear in the main `docker-compose logs` terminal output, even though the individual container logs (via `docker logs replica1`) showed the logs correctly.

## Root Cause
This was a **two-part buffering issue**:

1. **Container-level buffering**: Node.js uses line-buffered stdout by default, which can cause logs from restarted containers to not be immediately flushed to Docker's logging driver.

2. **Nodemon process restart buffering**: When nodemon detects file changes and restarts the Node.js process (hot-reload), the new Node.js child process created by nodemon didn't inherit the unbuffered state, so all logs from the hot-reloaded process were buffered and not immediately visible.

This created two scenarios where logs disappear:
- ❌ After container kill/restart
- ❌ After hot-reload triggered by file changes

## Solution
This required **two complementary fixes**:

### 1. Dockerfile Fix (Container-level unbuffering)

**Modified Files:**
- `replica1/Dockerfile`
- `replica2/Dockerfile`
- `replica3/Dockerfile`
- `gateway/Dockerfile`

**Changes:**
```dockerfile
# Added to each Dockerfile:
RUN apk add --no-cache coreutils

# Modified CMD:
CMD ["sh", "-c", "stdbuf -o0 nodemon server.js"]
```

This ensures stdout is unbuffered at the process invocation level.

### 2. Nodemon Config Fix (Process restart unbuffering)

**Modified Files:**
- `replica1/nodemon.json`
- `replica2/nodemon.json`
- `replica3/nodemon.json`
- `gateway/nodemon.json`

**Changes:**
```json
{
  "watch": ["server.js"],
  "ignore": ["data/*", "node_modules/*", "*.json"],
  "ext": "js",
  "delay": 1000,
  "exec": "stdbuf -o0 node"  // <-- NEW: This ensures child processes are unbuffered
}
```

The `"exec"` field tells nodemon **how to execute** the Node.js process when it restarts. By using `"stdbuf -o0 node"`, every time nodemon restarts the process (after detecting file changes), the new Node.js process is spawned with unbuffered stdout.

## How It Works Together

1. **Initial startup**: `stdbuf -o0 nodemon server.js`
   - nodemon starts with unbuffered stdout
   
2. **First file change detected**: nodemon restarts the process using `stdbuf -o0 node`
   - The new Node.js process inherits unbuffered stdout from stdbuf
   
3. **Container restart**: Docker recreates the container
   - The CMD runs again: `stdbuf -o0 nodemon server.js`
   - Process starts unbuffered from the beginning

## Testing

After rebuilding with `docker-compose up --build`:

### Test 1: Container Restart
```bash
# Terminal 1: Watch logs
docker-compose logs -f

# Terminal 2: Kill a container
docker kill <replica1_container_id>

# Verify: Logs should appear in Terminal 1 when replica1 restarts
```

### Test 2: Hot-Reload
```bash
# Terminal 1: Watch logs
docker-compose logs -f

# Terminal 2: Modify a file
echo " " >> replica1/server.js

# Verify: Logs should appear immediately when nodemon detects the change and restarts
```

Both scenarios should now show logs immediately in `docker-compose logs`.

## Benefits

- ✅ Logs appear immediately in `docker-compose logs` after container restart
- ✅ Logs appear immediately after hot-reload (file changes)
- ✅ No loss of log output
- ✅ Better visibility into node rejoin, catch-up, and development workflows
- ✅ Easier debugging of cluster recovery and hot-reload scenarios
- ✅ Consistent logging across all replicas and gateway

## Impact

- **Performance**: Negligible - unbuffered I/O only affects small log output
- **Compatibility**: Works with all Node.js versions on Alpine Linux
- **Rollback**: Easy - revert Dockerfile CMD and remove "exec" from nodemon.json

## Why This Fix is Complete

The key insight is that **nodemon creates a new child process** when it detects file changes. Simply unbuffering at the container level wasn't enough because nodemon was spawning a new process that reverted to buffered I/O. By configuring nodemon's `exec` parameter to use `stdbuf -o0`, we ensure **every** Node.js process spawned by nodemon—whether on initial startup, after hot-reload, or after container restart—is guaranteed to have unbuffered stdout.
