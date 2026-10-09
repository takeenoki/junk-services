import { handleRandomMagazineTitle } from "./api/random-magazine-title/index";
import { handleRandomJumpTitle } from "./api/random-jump-title/index";
import { handleRandomSundayTitle } from "./api/random-sunday-title/index";
import { handleAboutMe } from "./api/about_me";

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

    if (path === "/api/random-sunday-title") {
      return handleRandomSundayTitle(request, env.DB);
    }

    if (path === "/api/random-magazine-title") {
      return handleRandomMagazineTitle(request, env.DB);
    }

    if (path === "/api/about-me") {
      return handleAboutMe(request, env.DB);
    }

    if (path.startsWith("/api/")) {
      return Response.json({ error: "APIが見つかりません。" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
