/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Graph/Anthropic SDKs are server-only; keep them out of the client bundle.
  experimental: {
    serverComponentsExternalPackages: [
      "@azure/identity",
      "@microsoft/microsoft-graph-client",
      "@anthropic-ai/sdk",
      "@prisma/client",
    ],
  },
};

export default nextConfig;
