# Base image with Node + Debian (needed for ffmpeg)
FROM node:20-bullseye


# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Set working directory
WORKDIR /app

# Copy BOTH package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies using lockfile
RUN npm ci --omit=dev

# Copy the rest of the project files
COPY . .

# Expose port
ENV PORT=8080
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
