FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# Copy package.json and package-lock.json
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Expose ports
EXPOSE 8989

# Run the server
CMD ["node", "server.js"] 