FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Expose ports
# Main game server port
EXPOSE 8989
# Diagnostic WebSocket port
EXPOSE 8990

# Set environment variable to indicate Docker environment
ENV NODE_ENV=production
ENV IS_DOCKER=true

# Run the server
CMD ["npm", "start"] 