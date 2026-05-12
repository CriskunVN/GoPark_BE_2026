FROM node:22

EXPOSE 8000

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .


RUN npm run build


CMD ["npm", "start"]