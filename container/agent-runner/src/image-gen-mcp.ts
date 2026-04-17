/**
 * Image Generation MCP Server
 * Uses Gemini Imagen (free with Pro plan) or DALL-E 3 as fallback.
 * Tool: generate_image
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

function httpsPost(url: string, headers: Record<string, string>, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c.toString());
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function generateWithGemini(prompt: string, style: string): Promise<{ filepath: string; description: string }> {
  const fullPrompt = style ? `${style} style: ${prompt}` : prompt;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Generate a professional image: ${fullPrompt}` }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const resp = await httpsPost(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_KEY}`,
    { 'Content-Type': 'application/json' },
    body,
  );

  const data = JSON.parse(resp);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.mimeType?.startsWith('image/')) {
      const ext = part.inlineData.mimeType.includes('png') ? 'png' : 'jpg';
      const filename = `generated-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const filepath = path.join('/workspace/group', 'scratchpad', filename);
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, Buffer.from(part.inlineData.data, 'base64'));
      return { filepath, description: 'Image generated with Gemini Imagen (free)' };
    }
  }

  throw new Error('No image returned by Gemini');
}

async function generateWithDalle(prompt: string, style: string): Promise<{ filepath: string; description: string }> {
  const body = JSON.stringify({
    model: 'dall-e-3',
    prompt: `${style ? style + ' style: ' : ''}${prompt}`,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
  });

  const resp = await httpsPost(
    'https://api.openai.com/v1/images/generations',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body,
  );

  const data = JSON.parse(resp);
  if (data.error) throw new Error(data.error.message);

  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error('No image URL returned');

  const imageData = await new Promise<Buffer>((resolve, reject) => {
    https.get(imageUrl, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });

  const filename = `generated-${crypto.randomBytes(4).toString('hex')}.png`;
  const filepath = path.join('/workspace/group', 'scratchpad', filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, imageData);
  return { filepath, description: 'Image generated with DALL-E 3 (~$0.04)' };
}

const server = new McpServer({ name: 'image_gen', version: '1.0.0' });

server.tool(
  'generate_image',
  'Generate a professional image for LinkedIn posts, presentations, or marketing. Uses Gemini Imagen (free) with DALL-E 3 fallback.',
  {
    prompt: z.string().describe('Detailed description of the image to generate. Be specific about composition, colors, style.'),
    style: z.string().optional().describe('Style: professional, minimalist, corporate, illustration, photorealistic, infographic'),
  },
  async ({ prompt, style }) => {
    const s = style || 'professional';

    if (!GEMINI_KEY && !OPENAI_KEY) {
      return { content: [{ type: 'text' as const, text: 'No image generation API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY.' }] };
    }

    try {
      let result;
      if (GEMINI_KEY) {
        try {
          result = await generateWithGemini(prompt, s);
        } catch (e: unknown) {
          if (OPENAI_KEY) {
            result = await generateWithDalle(prompt, s);
          } else {
            throw e;
          }
        }
      } else {
        result = await generateWithDalle(prompt, s);
      }

      return {
        content: [{ type: 'text' as const, text: `Image saved to: ${result.filepath}\n${result.description}\n\nYou can reference this image when posting to LinkedIn.` }],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text' as const, text: `Image generation failed: ${msg}` }] };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
