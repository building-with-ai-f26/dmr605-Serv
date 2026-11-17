# Runs Serv on any host that takes a container (Render, Railway, Fly). See DEPLOY.md.
# The app has no packages to install, so the image is just Node and the source.
FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
COPY app ./app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 AI_PROVIDER=openrouter
EXPOSE 3000
USER node
CMD ["node", "app/server.mjs"]
