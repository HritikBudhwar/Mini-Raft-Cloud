FROM node:20-alpine

WORKDIR /app

# Install nodemon globally for hot-reload
RUN npm install -g nodemon

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

EXPOSE 3000

# Disable Node.js buffering to ensure logs appear in docker-compose logs immediately
# Use stdbuf to disable buffering for stdout
RUN apk add --no-cache coreutils

CMD ["sh", "-c", "stdbuf -o0 nodemon server.js"]
