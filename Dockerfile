FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 3006
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
