# Worker de Crevy Studio — motor de variantes de video.
# No expone puertos: es un proceso de polling contra Supabase.
# Node 22+ es obligatorio: @supabase/supabase-js 2.110+ usa WebSocket nativo
# (realtime-js) que no existe en Node 20 y hace crashear createClient.
FROM node:22-slim

# ffmpeg-static trae su propio binario, así que NO necesitamos apt install ffmpeg.
# Sólo hace falta que exista el runtime de glibc (node:22-slim ya lo tiene).

WORKDIR /app

# Instalar deps primero para aprovechar la cache de capas.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Código del worker.
COPY . .

ENV NODE_ENV=production

# Proceso de larga duración; sin healthcheck HTTP (no hay puerto).
CMD ["node", "index.mjs"]
