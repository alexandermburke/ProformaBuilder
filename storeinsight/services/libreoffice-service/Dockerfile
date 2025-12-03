# Simple container for LibreOffice conversions
FROM node:18-bookworm

# Install LibreOffice
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends libreoffice && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
