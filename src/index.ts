import { handleRandomMagazineTitle } from "./api/random-magazine-title/index";
import { handleRandomJumpTitle } from "./api/random-jump-title/index";
import { handleRandomSundayTitle } from "./api/random-sunday-title/index";
import { handleAboutMe } from "./api/about_me";
import { handleBeepers } from "./api/beepers";
import { handleSteps } from "./api/steps";
import { handleJevImagePlayground } from "./api/jev-image-playground";
import { handleJevMazeDemo } from "./api/jev-maze-demo";
export { Beepers } from "./api/beepers";
export { Minamo } from "./api/minamo";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MINAMO: DurableObjectNamespace;
  BEEPERS: DurableObjectNamespace;
  ENABLE_POST_LIMIT?: string;
  STEPS_GOOGLE_CLIENT_ID?: string;
  STEPS_GOOGLE_SUB?: string;
  JEV_IMAGE_PLAYGROUND_API_KEY?: string;
  JEV_IMAGE_PLAYGROUND_MODEL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/jev-maze-demo") {
      return handleJevMazeDemo(request, env);
    }

    if (path === "/api/jev-image-playground") {
      return handleJevImagePlayground(request, env);
    }

    if (path === "/api/v1" || path.startsWith("/api/v1/")) {
      return handleSteps(request, env);
    }

    if (path.startsWith("/api/beepers/")) {
      return handleBeepers(request, env);
    }

    if (path === "/api/minamo") {
      return env.MINAMO.get(env.MINAMO.idFromName("shared-water")).fetch(request);
    }

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
