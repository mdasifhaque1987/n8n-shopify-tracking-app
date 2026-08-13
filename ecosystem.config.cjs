module.exports = {
  apps: [
    {
      name: "dh-conversions",
      cwd: "/home/asif-haque/Downloads/dh-tracking-app-new",
      script: "node_modules/@react-router/serve/bin.js",
      args: "build/server/index.js",

      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000"
      },

      env_file: "/home/asif-haque/Downloads/dh-tracking-app-new/.env",

      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true
    },

    {
      name: "dh-orders-worker",
      cwd: "/home/asif-haque/Downloads/dh-tracking-app-new",
      script: "build/worker/order-webhook-worker.mjs",

      env: {
        NODE_ENV: "production"
      },

      env_file: "/home/asif-haque/Downloads/dh-tracking-app-new/.env",

      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true
    }
  ]
};
