FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').request({host:'127.0.0.1',port:3006,path:'/health'}).once('response',(r)=>process.exit(r.statusCode===200?0:1)).end()"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]