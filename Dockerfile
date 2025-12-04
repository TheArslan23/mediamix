# Base image with Node + Debian (needed for ffmpeg)
FROM node:18-bullseye

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Set working directory
WORKDIR /app

# Copy only package.json first
COPY package.json ./

# Install dependencies (no package-lock needed)
RUN npm install --production

# Copy the rest of the app
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
