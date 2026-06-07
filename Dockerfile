FROM node:18-alpine

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy the rest of the application files
COPY . .

# Hugging Face Spaces run on port 7860 by default
ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
