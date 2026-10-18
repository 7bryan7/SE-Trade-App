import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const clientId = (process.env.VITE_GOOGLE_CLIENT_ID ?? env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  if (command === 'build' && !/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Set VITE_GOOGLE_CLIENT_ID to your Google OAuth Web Client ID before building. In Vercel, add it in Project Settings > Environment Variables and redeploy.');
  }
  return { plugins: [react(), tailwindcss()], server: { host: '127.0.0.1' } };
});
