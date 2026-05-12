FROM node:20-alpine

# Segurança: não rodar como root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Instala dependências primeiro (cache de layers)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copia o código-fonte
COPY src/ ./src/

# Permissão para o usuário da aplicação
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080

ENV PORT=8080
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "src/server.js"]
