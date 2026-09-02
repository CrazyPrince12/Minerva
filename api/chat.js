// api/chat.js
// Proxy serverless compatible Vercel (/api/chat) et Render (via server.js).
// Les clés GROQ_API_KEY sont lues uniquement côté serveur :
// elles ne sont jamais exposées au client.

// Deux fournisseurs cohabitent sans conflit (voir src/models.js) :
//   - Groq       : modèles openai/gpt-oss-*, groq/compound* (SDK OpenAI, baseURL Groq)
