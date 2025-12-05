# Base image with Node + Debian (needed for ffmpeg)
FROM node:18-bullseye

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Set working directory
WORKDIR /app

# Copy package.json only
COPY package.json ./

# Install dependencies normally (no lockfile required)
RUN npm install --production

# Copy the rest of the files
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
