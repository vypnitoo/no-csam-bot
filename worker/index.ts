interface Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  API_KEY: string;
}

interface DetectionRequest {
  imageUrl: string;
}

interface DetectionResponse {
  detected: boolean;
  confidence: number;
  provider: string;
  labels?: string[];
  processingTimeMs: number;
  error?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = request.headers.get('X-API-Key');
    if (!apiKey || apiKey !== env.API_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const body: DetectionRequest = await request.json();
      const { imageUrl } = body;

      if (!imageUrl) {
        return new Response(JSON.stringify({ error: 'imageUrl is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const result = await detectImage(imageUrl, env);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error.message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

async function detectImage(imageUrl: string, env: Env): Promise<DetectionResponse> {
  const startTime = Date.now();

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to fetch image');
    }

    const imageBuffer = await imageResponse.arrayBuffer();

    const aiResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/microsoft/resnet-50`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/octet-stream',
        },
        body: imageBuffer,
      }
    );

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json() as any;
    const result = aiResult.result || [];

    const nsfwLabels = result.filter((r: any) =>
      r.label?.toLowerCase().includes('nsfw') ||
      r.label?.toLowerCase().includes('nude') ||
      r.label?.toLowerCase().includes('adult')
    );

    const nsfwScore = nsfwLabels.length > 0 ? nsfwLabels[0].score : 0;

    return {
      detected: nsfwScore > 0.85,
      confidence: nsfwScore,
      provider: 'cloudflare-worker',
      labels: result.map((r: any) => r.label),
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      detected: false,
      confidence: 0,
      provider: 'cloudflare-worker',
      processingTimeMs: Date.now() - startTime,
      error: error.message,
    };
  }
}
