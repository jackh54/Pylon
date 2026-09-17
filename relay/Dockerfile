FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js ./
ENV NODE_ENV=production
USER node
CMD ["node", "index.js"]
