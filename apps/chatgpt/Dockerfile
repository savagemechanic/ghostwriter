FROM node:22-alpine

WORKDIR /app

COPY apps/chatgpt/package.json ./apps/chatgpt/package.json
RUN cd apps/chatgpt && npm install --omit=dev

COPY src ./src
COPY apps/chatgpt ./apps/chatgpt

ENV NODE_ENV=production
ENV CHATGPT_APP_PORT=8788
EXPOSE 8788

CMD ["node", "apps/chatgpt/src/server.js"]
