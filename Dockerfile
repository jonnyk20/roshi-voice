# Use the official lightweight Node.js 18 image.
# https://hub.docker.com/_/node
FROM node:20-alpine AS builder

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm install

# Copy the rest of the application code
COPY . ./

# Build the TypeScript code
RUN npm run build

# Stage 2: Create the production image
FROM node:20-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies.
# If you add a package-lock.json speed your build by switching to 'npm ci'.
# RUN npm ci --only=production
RUN npm install --production

# Copy the built files from the builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Expose the port
EXPOSE 8080

# Run the web service on container startup.
# Run the application
CMD ["node", "dist/index.js"]
