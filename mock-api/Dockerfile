FROM node:24-bookworm-slim

WORKDIR /app/mock-api

COPY mock-api/package*.json ./
RUN npm install

COPY mock-api/ ./
COPY references/ ../references/

RUN npm run build

ENV PORT=3000
ENV DB_PATH=/data/metasys-mock.db

EXPOSE 3000

CMD ["npm", "start"]
