const BASE_URL  = Deno.env.get("INSFORGE_BASE_URL") || Deno.env.get("INSFORGE_URL");
const ADMIN_KEY = Deno.env.get("INSFORGE_ADMIN_KEY") || Deno.env.get("API_KEY");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
};

export default async function (req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  
  let body;
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400, headers: CORS }); }
  
  const query = body.query;
  if (!query) return new Response("Query required", { status: 400, headers: CORS });
  
  try {
    const res = await fetch(`${BASE_URL}/rawsql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ADMIN_KEY}`,
        "apikey": ADMIN_KEY
      },
      body: JSON.stringify({ query })
    });
    
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
