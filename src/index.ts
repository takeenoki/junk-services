import { handleRandomJumpTitle } from "./api/random-jump-title/index";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/random-jump-title") {
      return handleRandomJumpTitle(request, env.DB);
    }

    if (path.startsWith("/api/")) {
      return Response.json({ error: "APIが見つかりません。" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
