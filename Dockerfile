# Dockerfile
FROM node:18-bullseye

# install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
